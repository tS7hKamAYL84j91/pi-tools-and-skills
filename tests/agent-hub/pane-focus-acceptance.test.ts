/**
 * Complementary acceptance tests for pane selection + focus. `pane-navigation.test.ts`
 * already covers identity validation, the navigator refusal matrix and basic key
 * events; this file covers the gaps: bracketed paste, selection rendering, and the
 * wired CLI path (pty + stub `zellij`, no live session touched).
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const navigationUrl = pathToFileURL(
	resolve("scripts/pi-agents-pane-navigation.mjs"),
).href;
const paneUrl = pathToFileURL(resolve("scripts/pi-agents-pane.mjs")).href;

function probe(code: string): unknown {
	return JSON.parse(
		spawnSync(process.execPath, ["--input-type=module", "-e", code], {
			encoding: "utf8",
			timeout: 10_000,
		}).stdout.trim(),
	);
}

const prelude = `const pane = await import(${JSON.stringify(paneUrl)});
const nav = await import(${JSON.stringify(navigationUrl)});`;

describe("bracketed paste", () => {
	const parse = (chunks: string[]) =>
		probe(`${prelude}
const parser = nav.inputParser();
const events = [];
${chunks.map((chunk) => `events.push(...parser(${JSON.stringify(chunk)}));`).join("\n")}
process.stdout.write(JSON.stringify(events));`) as { type: string }[];

	it("never quits on a paste that contains a q", () => {
		expect(parse(["\x1b[200~quit the build please\x1b[201~"])).toEqual([]);
	});

	it("never quits on a paste split across reads", () => {
		expect(parse(["\x1b[200~q", "uit\x1b[201~"])).toEqual([]);
	});

	it("still reads real keystrokes after a paste ends", () => {
		expect(parse(["\x1b[200~text\x1b[201~q"])).toEqual([{ type: "quit" }]);
	});
});

describe("selection rendering", () => {
	const view = {
		scope: "lead",
		leadState: "resolved",
		records: [
			{ id: "lead", name: "lead", status: "running" },
			{ id: "helper", name: "helper", status: "waiting" },
		],
		skipped: 0,
		truncated: false,
	};
	const render = (v: unknown, interaction: Record<string, unknown>) =>
		probe(`${prelude}
process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(v)}, 60, 20, false, ${JSON.stringify(interaction)})));`) as string;

	it("marks exactly the selected row, by id, and shows the key hint", () => {
		const out = render(view, { enabled: true, selectedId: "lead", offset: 0 });
		const selected = out
			.split("\n")
			.filter((line) => line.startsWith("\x1b[7m"));
		expect(selected).toHaveLength(1);
		expect(selected[0]).toContain("lead");
		expect(out).toContain("n:new c:close l:lead q:quit");
	});

	it("keeps the selection on the agent id when rows reorder", () => {
		const reordered = { ...view, records: [view.records[1], view.records[0]] };
		const out = render(reordered, {
			enabled: true,
			selectedId: "helper",
			offset: 0,
		});
		const selected = out
			.split("\n")
			.filter((line) => line.startsWith("\x1b[7m"));
		expect(selected).toHaveLength(1);
		expect(selected[0]).toContain("helper");
	});

	it("renders no highlight and no key hint when interaction is disabled", () => {
		const out = render(view, { enabled: false });
		expect(out).not.toContain("\x1b[7m");
		expect(out).not.toContain("j/k");
		expect(out.trimEnd().endsWith("q:quit")).toBe(true);
	});

	it("sanitizes the notice and keeps it above the footer", () => {
		const out = render(view, {
			enabled: true,
			selectedId: "lead",
			notice: "\x1b[31mboom\x1b[0m\nnext",
		});
		expect(out).not.toContain("\x1b[31m");
		expect(out).not.toContain("\nnext");
		expect(out.trimEnd().split("\n").at(-2)).toContain("boom");
	});
});

const hasScript =
	spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;

function startedAt(pid: number): number {
	const stat = readFileSync("/proc/stat", "utf8");
	const btime = Number(/^btime (\d+)$/m.exec(stat)?.[1]);
	const line = readFileSync(`/proc/${pid}/stat`, "utf8");
	const fields = line
		.slice(line.lastIndexOf(")") + 2)
		.trim()
		.split(/\s+/);
	return btime * 1000 + Number(fields[19]) * 10;
}

describe("pane cli focus wiring (pty, stub zellij)", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function fixture() {
		dir = mkdtempSync(join(tmpdir(), "pane-focus-"));
		const registry = join(dir, "agents");
		const bin = join(dir, "bin");
		const log = join(dir, "zellij.log");
		mkdirSync(registry, { recursive: true });
		mkdirSync(bin, { recursive: true });
		writeFileSync(log, "");
		const base = {
			pid: process.pid,
			startedAt: startedAt(process.pid),
			heartbeat: Date.now() - 500,
			status: "running",
			model: "fixture/model",
			cwd: "/w",
		};
		writeFileSync(
			join(registry, "lead.json"),
			JSON.stringify({
				...base,
				id: "lead",
				name: "lead",
				declared_name: "lead",
				zellij: { sessionName: "S", paneId: 1 },
			}),
		);
		writeFileSync(
			join(registry, "helper.json"),
			JSON.stringify({
				...base,
				id: "helper",
				name: "helper",
				namespace: "lead",
				cwd: "/w/helper",
				zellij: { sessionName: "S", paneId: 7 },
			}),
		);
		writeFileSync(
			join(bin, "zellij"),
			`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ZELLIJ_STUB_LOG, JSON.stringify(args) + "\\n");
if (args.includes("list-panes")) process.stdout.write(JSON.stringify([
	{ id: 1, is_plugin: false, is_focused: true, tab_id: 0, pane_cwd: "/w" },
	{ id: 7, is_plugin: false, is_focused: false, tab_id: 0, pane_cwd: "/w/helper" }
]));
`,
		);
		chmodSync(join(bin, "zellij"), 0o755);
		return { registry, bin, log };
	}

	const runInPty = (args: string[], input: string, env: NodeJS.ProcessEnv) =>
		spawnSync(
			"sh",
			[
				"-c",
				'(sleep 0.5; printf "%s" "$1") | script -qec "$2" /dev/null',
				"fixture",
				input,
				[process.execPath, resolve("scripts/pi-agents-pane"), ...args].join(
					" ",
				),
			],
			{
				encoding: "utf8",
				timeout: 10_000,
				env,
			},
		);

	const calls = (log: string) =>
		readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as string[]);

	it.skipIf(!hasScript)(
		"focuses the selected helper pane exactly once, and only on enter",
		() => {
			const { registry, bin, log } = fixture();
			const env = {
				...process.env,
				ZELLIJ: "0",
				ZELLIJ_SESSION_NAME: "S",
				ZELLIJ_PANE_ID: "1",
				ZELLIJ_STUB_LOG: log,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
			};
			const args = [
				"--scope",
				"lead",
				"--registry",
				registry,
				"--interval",
				"0.5",
				"--no-color",
			];

			const before = runInPty(args, "q", env);
			expect(before.status).toBe(0);
			expect(
				calls(log).filter((argv) => argv.includes("focus-pane-id")),
			).toEqual([]);
			expect(calls(log).some((argv) => argv.includes("list-panes"))).toBe(true);

			writeFileSync(log, "");
			const after = runInPty(args, "jj\rq", env);
			expect(after.status).toBe(0);
			const focus = calls(log).filter((argv) => argv.includes("focus-pane-id"));
			expect(focus).toEqual([
				["--session", "S", "action", "focus-pane-id", "terminal_7"],
			]);
			for (const argv of calls(log)) expect(argv).not.toContain("send-keys");
		},
	);

	it.skipIf(!hasScript)("never touches zellij for --once or --json", () => {
		const { registry, bin, log } = fixture();
		const env = {
			...process.env,
			ZELLIJ: "0",
			ZELLIJ_SESSION_NAME: "S",
			ZELLIJ_PANE_ID: "1",
			ZELLIJ_STUB_LOG: log,
			PATH: `${bin}:${process.env.PATH ?? ""}`,
		};
		for (const extra of [["--once"], ["--json"]]) {
			const result = spawnSync(
				resolve("scripts/pi-agents-pane"),
				["--scope", "lead", "--registry", registry, ...extra],
				{
					encoding: "utf8",
					env,
				},
			);
			expect(result.status).toBe(0);
		}
		expect(readFileSync(log, "utf8").trim()).toBe("");
	});
});

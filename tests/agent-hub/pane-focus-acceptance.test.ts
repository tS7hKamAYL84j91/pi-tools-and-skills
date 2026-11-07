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
import { paneChildEnv } from "./helpers.js";

const navigationUrl = pathToFileURL(
	resolve("agent-hub-pane/pi-agents-pane-navigation.mjs"),
).href;
const paneUrl = pathToFileURL(resolve("agent-hub-pane/pi-agents-pane.mjs")).href;

function probe(code: string): unknown {
	return JSON.parse(
		spawnSync(process.execPath, ["--input-type=module", "-e", code], {
			encoding: "utf8",
			timeout: 10_000,
			env: paneChildEnv(),
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
	spawnSync("script", ["--version"], { encoding: "utf8", env: paneChildEnv() }).status === 0;

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

	const runInPty = (args: string[], input: string | string[], env: NodeJS.ProcessEnv) =>
		spawnSync("python3", ["-c", `
import json, os, select, shlex, subprocess, sys, time
command=shlex.join(json.loads(sys.argv[1]))
p=subprocess.Popen(['script','-qec',command,'/dev/null'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
data=b''; transcript=b''
def until(needle):
    global data, transcript
    deadline=time.monotonic()+3
    while needle not in data and time.monotonic()<deadline:
        if select.select([p.stdout],[],[],0.02)[0]:
            chunk=os.read(p.stdout.fileno(),65536)
            if not chunk: break
            data+=chunk; transcript+=chunk
    assert needle in data, repr(data)
try:
    until(b'q:quit')
    for text in json.loads(sys.argv[2]):
        data=b''; p.stdin.write(text.encode()); p.stdin.flush()
        if text=='q': until(b'\\x1b[?25h')
        else:
            # Wait for actual UI completion before another focus/quit input.
            # Two rows: pending notice adds line 5; completion clears that line.
            until(b'Checking pane')
            until(b'\\x1b[4;1H\\x1b[2Kn:new c:close l:lead q:quit\\x1b[5;1H\\x1b[2K')
    assert p.wait(timeout=2)==0
    sys.stdout.buffer.write(transcript)
finally:
    if p.poll() is None: p.kill(); p.wait()
`, JSON.stringify([process.execPath, resolve("agent-hub-pane/pi-agents-pane"), ...args]), JSON.stringify(Array.isArray(input) ? input : [input])], {
			encoding: "utf8", timeout: 10_000, env,
		});

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
			const env = paneChildEnv({
				ZELLIJ: "0",
				ZELLIJ_SESSION_NAME: "S",
				ZELLIJ_PANE_ID: "1",
				ZELLIJ_STUB_LOG: log,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
			});
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
			expect(calls(log)).toEqual([]); // no unsolicited metadata scan on startup/quit

			writeFileSync(log, "");
			const after = runInPty(args, ["jj\r", "q"], env);
			expect(after.status).toBe(0);
			const focus = calls(log).filter((argv) => argv.includes("focus-pane-id"));
			expect(focus).toEqual([
				["--session", "S", "action", "focus-pane-id", "terminal_7"],
			]);
			for (const argv of calls(log)) expect(argv).not.toContain("send-keys");
		},
	);

	it.skipIf(!hasScript)("keeps mouse reporting active between return clicks without waiting for a poll", () => {
		const { registry, bin, log } = fixture();
		const result = runInPty(
			["--scope", "lead", "--registry", registry, "--interval", "60", "--no-color"],
			["\x1b[<0;8;3M", "\x1b[<0;8;3M", "q"],
			paneChildEnv({
				PI_AGENTS_PANE_STARTUP_DELAY: "20",
				ZELLIJ: "0",
				ZELLIJ_SESSION_NAME: "S",
				ZELLIJ_PANE_ID: "1",
				ZELLIJ_STUB_LOG: log,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
			}),
		);
		expect(result.status).toBe(0);
		expect(calls(log).filter((argv) => argv.includes("focus-pane-id"))).toEqual([
			["--session", "S", "action", "focus-pane-id", "terminal_7"],
			["--session", "S", "action", "focus-pane-id", "terminal_7"],
		]);
		// Mouse reporting is disabled only as part of terminal cleanup on quit.
		expect(result.stdout.split("\x1b[?1000l")).toHaveLength(2);
		expect(result.stdout).toContain("\x1b[?1000l\x1b[?1006l\x1b[?2004l");
	});

	it.skipIf(!hasScript)("never touches zellij for --once or --json", () => {
		const { registry, bin, log } = fixture();
		const env = paneChildEnv({
			ZELLIJ: "0",
			ZELLIJ_SESSION_NAME: "S",
			ZELLIJ_PANE_ID: "1",
			ZELLIJ_STUB_LOG: log,
			PATH: `${bin}:${process.env.PATH ?? ""}`,
		});
		for (const extra of [["--once"], ["--json"]]) {
			const result = spawnSync(
				resolve("agent-hub-pane/pi-agents-pane"),
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

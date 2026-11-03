import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	lstatSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const executable = resolve("scripts/pi-agents-pane");
const moduleUrl = pathToFileURL(resolve("scripts/pi-agents-pane.mjs")).href;
let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "hub-pane-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});
function record(id: string, fields: Record<string, unknown> = {}) {
	writeFileSync(
		join(dir, `${id}.json`),
		JSON.stringify({
			id,
			name: id,
			pid: 2147483647,
			startedAt: 0,
			heartbeat: 0,
			status: "waiting",
			model: "fixture/model",
			...fields,
		}),
	);
}
function cli(...args: string[]) {
	return spawnSync(
		executable,
		["--scope", "lead", "--registry", dir, ...args],
		{ encoding: "utf8", cwd: tmpdir(), timeout: 3000 },
	);
}
function evaluate(code: string): string {
	return execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import * as pane from ${JSON.stringify(moduleUrl)}; ${code}`,
		],
		{ encoding: "utf8" },
	).trim();
}
function tree(path: string): unknown {
	return readdirSync(path)
		.sort()
		.map((name) => {
			const full = join(path, name),
				stat = lstatSync(full);
			return [
				name,
				stat.mode,
				stat.mtimeMs,
				stat.isDirectory() ? tree(full) : readFileSync(full).toString("base64"),
			];
		});
}

it("scopes by declared identity and exact namespace, never cwd or display prefix", () => {
	record("lead-record", { name: "mutable-title", declared_name: "lead" });
	record("helper", {
		name: "own-name",
		namespace: "lead",
		parentId: "lead-record",
	});
	record("grandchild", { namespace: "lead", parentId: "helper" });
	record("other", { declared_name: "another" });
	record("other-helper", { namespace: "another" });
	record("lookalike", { name: "lead-fake", cwd: "/same" });
	record("external", { name: "lead", kind: "external" });
	record("alias", { name: "lead", declared_name: "another" });
	const result = cli("--json");
	expect(result.status).toBe(0);
	const view = JSON.parse(result.stdout);
	expect(view.leadState).toBe("unavailable"); // matching lead is dead, helpers remain visible
	expect(view.records.map((r: { id: string }) => r.id)).toEqual([
		"lead-record",
		"grandchild",
		"helper",
	]);
	expect(view.records[2].name).toBe("own-name");
	expect(cli("--once", "--json").stdout).toBe(result.stdout);
});

it("supports legacy leads and reports ambiguity without broadening scope", () => {
	record("legacy", { name: "lead" });
	expect(JSON.parse(cli("--json").stdout).records[0].lead).toBe(true);
	record("declared", { declared_name: "lead" });
	expect(JSON.parse(cli("--json").stdout).leadState).toBe("ambiguous");
});

it("reports renamed root collisions as ambiguous rather than trusting a display alias", () => {
	record("root", { name: "lead", declared_name: "lead" });
	record("renamed", { name: "lead-2", declared_name: "lead", namespace: null });
	const view = JSON.parse(cli("--json").stdout);
	expect(view.leadState).toBe("ambiguous");
	expect(view.records).toHaveLength(2);
	expect(view.records.every((row: { lead: boolean }) => row.lead)).toBe(true);
});

it.each([
	"--once",
	"--json",
	"continuous",
])("handles a closed stdout consumer in %s mode", async (mode) => {
	for (let i = 0; i < 100; i++) record(`child-${i}`, { namespace: "lead" });
	const child = spawn(
		executable,
		[
			"--scope",
			"lead",
			"--registry",
			dir,
			...(mode === "continuous" ? [] : [mode]),
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let errors = "";
	child.stderr.on("data", (data: Buffer) => {
		errors += data.toString();
	});
	const done = new Promise<number | null>((resolveDone, reject) => {
		child.once("error", reject);
		child.once("exit", resolveDone);
	});
	const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
	child.stdout.destroy();
	try {
		expect(await done).toBe(0);
		expect(errors).toBe("");
	} finally {
		clearTimeout(timer);
		child.kill("SIGKILL");
	}
});

it("keeps exact-namespace helpers when lead is unavailable", () => {
	record("child", { namespace: "lead" });
	const view = JSON.parse(cli("--json").stdout);
	expect(view.leadState).toBe("unavailable");
	expect(view.records).toHaveLength(1);
	expect(view.records[0].lead).toBe(false);
});

it("ignores journal, directories, symlinks, malformed and oversized records", () => {
	record("good", { declared_name: "lead" });
	writeFileSync(join(dir, "namespace-owners.json"), "{");
	writeFileSync(join(dir, "bad.json"), "{");
	writeFileSync(join(dir, "huge.json"), " ".repeat(65537));
	mkdirSync(join(dir, "sub.json"));
	symlinkSync(join(dir, "good.json"), join(dir, "link.json"));
	record("invalid", { pid: -1 });
	const view = JSON.parse(cli("--json").stdout);
	expect(view.records).toHaveLength(1);
	expect(view.skipped).toBe(3);
});

it("maps only the recorded current session filename, never reads session or mailbox content", () => {
	const session = join(dir, "2026-11-03T09-00-00-000Z_custom-session.jsonl");
	writeFileSync(session, "PRIVATE TRANSCRIPT NOT TO BE READ");
	record("lead", { sessionFile: session });
	mkdirSync(join(dir, "lead", "inbox", "new"), { recursive: true });
	writeFileSync(
		join(dir, "lead", "inbox", "new", "message"),
		"PRIVATE MESSAGE",
	);
	const before = tree(dir);
	const output = cli("--json").stdout;
	const row = JSON.parse(output).records[0];
	expect(row.sessionId).toBe("custom-session");
	expect(row.sessionTitle).toBeNull();
	expect(output).not.toContain("PRIVATE");
	expect(tree(dir)).toEqual(before);
});

it("handles missing session metadata without inventing a title or session ID", () => {
	record("lead");
	const row = JSON.parse(cli("--json").stdout).records[0];
	expect(row.sessionId).toBeNull();
	expect(row.sessionTitle).toBeNull();
});

it("classifies process generation, dead pid, zombies and missing proc deterministically", () => {
	const result = evaluate(`
		const fields = ['S', ...Array(18).fill('0'), '100'];
		const read = path => path === '/proc/stat' ? 'btime 1000\\n' : '123 (has ) spaces) ' + fields.join(' ');
		const record = { pid: 123, startedAt: 1001000 };
		const dead = path => { if (path === '/proc/stat') return read(path); throw Object.assign(new Error(), { code: 'ENOENT' }); };
		process.stdout.write(JSON.stringify([
			pane.processState(record, read), pane.processState({...record, startedAt: 1}, read),
			pane.processState(record, dead), pane.processState(record, () => { throw new Error(); }),
			pane.processState(record, path => read(path).replace(' S ', ' Z ')),
			pane.processState({...record, startedAt: record.startedAt + 119999}, read),
			pane.processState({...record, startedAt: record.startedAt + 120001}, read)
		]));
	`);
	expect(JSON.parse(result)).toEqual([
		"live",
		"stale",
		"stale",
		"unknown",
		"stale",
		"live",
		"live",
	]);
});

it.each([
	{ offset: -130000, state: "stale" },
	{ offset: -120001, state: "stale" },
	{ offset: -120000, state: "live" },
	{ offset: 120000, state: "live" },
	{ offset: 130000, state: "live" },
	{ offset: 600000, state: "live" },
])("uses one-sided PID reuse tolerance at registration offset $offset", ({
	offset,
	state,
}) => {
	const result = evaluate(`
		const fields = ['S', ...Array(18).fill('0'), '100'];
		const read = path => path === '/proc/stat' ? 'btime 1000\\n' : '123 (fixture) ' + fields.join(' ');
		process.stdout.write(pane.processState({pid: 123, startedAt: 1001000 + ${offset}}, read));
	`);
	expect(result).toBe(state);
});

it("separates stale heartbeat from process liveness and marks future heartbeat unknown", () => {
	record("lead", { heartbeat: 1 });
	record("child", { namespace: "lead", heartbeat: 9999999999999 });
	const value = evaluate(
		`process.stdout.write(pane.render(pane.snapshot(${JSON.stringify(dir)}, 'lead', () => 'live'), 80, 40, 60000));`,
	);
	expect(value).toContain("lead: resolved");
	expect(value).toContain("waiting / live");
	expect(value).toContain("seen 59s / old");
	expect(value).toContain("seen ? / unknown");
});

it("sanitizes ANSI, OSC, controls, newlines and bidi; truncates Unicode and terminal height", () => {
	record("lead", {
		declared_name: "lead",
		name: "\x1b[31mred\x1b[0m\n\x1b]8;;https://bad\x07link\x1b]8;;\x07\u202e",
		model: "模型😀".repeat(100),
	});
	const text = cli("--once", "--no-color").stdout;
	for (const control of ["\x1b", "\x07", "\u202e"])
		expect(text).not.toContain(control);
	expect(text).not.toContain("https://bad");
	const narrow = evaluate(
		`process.stdout.write(JSON.stringify(pane.render(pane.snapshot(${JSON.stringify(dir)}, 'lead'), 8, 5)));`,
	);
	const lines = (JSON.parse(narrow) as string).trimEnd().split("\n");
	expect(lines).toHaveLength(5);
	for (const line of lines) expect([...line].length).toBeLessThanOrEqual(8);
	expect(evaluate(`process.stdout.write(pane.clip('模型😀abc', 5));`)).toBe(
		"模型",
	);
});

it("returns explicit errors without creating a missing registry", () => {
	rmSync(dir, { recursive: true });
	const result = cli("--json");
	expect(result.status).toBe(3);
	expect(JSON.parse(result.stdout)).toEqual({
		error: "registry unreadable",
		path: dir,
	});
	expect(cli("--once").status).toBe(3);
});

it.each(
	[
		[],
		["--scope"],
		["--scope", "lead", "--interval", "0"],
		["--scope", "lead", "--bad"],
		["--scope", "../bad"],
	].map((args) => ({ args })),
)("rejects invalid usage $args", ({ args }) => {
	expect(spawnSync(executable, args, { encoding: "utf8" }).status).toBe(2);
});

it("restores terminal state on q and redraws after resize (isolated PTY)", () => {
	record("lead");
	const output = execFileSync(
		"python3",
		[
			"-c",
			`
import os, pty, subprocess, termios, fcntl, struct, select, time, signal, sys
master, slave = pty.openpty()
before = termios.tcgetattr(slave)
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 28, 0, 0))
p = subprocess.Popen([sys.argv[1], '--scope', 'lead', '--registry', sys.argv[2], '--interval', '10'], stdin=slave, stdout=slave, stderr=slave)
data = b''
def until(needle):
    global data
    deadline = time.monotonic() + 3
    while needle not in data and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]: data += os.read(master, 65536)
    assert needle in data, repr(data)
try:
    until(b'read-only')
    assert b'\\x1b[?25l' in data
    data = b''
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 10, 12, 0, 0))
    p.send_signal(signal.SIGWINCH)
    until(b'\\x1b[2J')
    os.write(master, b'q')
    until(b'\\x1b[?25h')
    assert p.wait(timeout=3) == 0
    assert termios.tcgetattr(slave) == before
    print('restored')
finally:
    if p.poll() is None: p.kill(); p.wait()
    os.close(master); os.close(slave)
`,
			executable,
			dir,
		],
		{ encoding: "utf8", timeout: 10000 },
	);
	expect(output.trim()).toBe("restored");
});

it("prints help from a foreign cwd", () => {
	const result = spawnSync(executable, ["--help"], {
		encoding: "utf8",
		cwd: tmpdir(),
	});
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("--scope");
});

it("retries unreadable registry and exits cleanly on SIGTERM", async () => {
	rmSync(dir, { recursive: true });
	const child = spawn(
		executable,
		["--scope", "lead", "--registry", dir, "--interval", "0.25"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	const done = new Promise<number | null>((resolveDone, reject) => {
		child.once("error", reject);
		child.once("exit", resolveDone);
	});
	const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
	child.stdout.on("data", (data: Buffer) => {
		output += data.toString();
		if (
			output.includes("registry unreadable") &&
			!output.includes("lead: unavailable")
		) {
			mkdirSync(dir, { recursive: true });
			record("lead");
		}
		if (output.includes("lead: unavailable")) child.kill("SIGTERM");
	});
	try {
		expect(await done).toBe(0);
	} finally {
		clearTimeout(timeout);
		child.kill("SIGKILL");
	}
	expect(output).toContain("registry unreadable");
	expect(output).toContain("lead: unavailable");
});

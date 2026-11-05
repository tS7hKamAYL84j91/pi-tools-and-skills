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
	chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { paneChildEnv } from "./helpers.js";

const executable = resolve("agent-hub-pane/pi-agents-pane");
const moduleUrl = pathToFileURL(resolve("agent-hub-pane/pi-agents-pane.mjs")).href;
let dir: string;
beforeEach(() => {
	vi.stubEnv("PI_AGENTS_PANE_STARTUP_DELAY", "0");
	dir = mkdtempSync(join(tmpdir(), "hub-pane-"));
});
afterEach(() => {
	vi.unstubAllEnvs();
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
it("refresh defaults to two seconds but accepts an explicit override", () => {
	const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
		const { parseArgs } = await import(${JSON.stringify(moduleUrl)});
		process.stdout.write(JSON.stringify([
			parseArgs(["--scope", "lead"]).interval,
			parseArgs(["--scope", "lead", "--interval", "5"]).interval,
		]));
	`], { encoding: "utf8", env: paneChildEnv() });
	expect(JSON.parse(output)).toEqual([2, 5]);
});

it("PI_AGENTS_PANE_INTERVAL seeds the default but an explicit --interval wins", () => {
	const code = `
		const { parseArgs } = await import(${JSON.stringify(moduleUrl)});
		process.stdout.write(JSON.stringify([
			parseArgs(["--scope", "lead"]).interval,
			parseArgs(["--scope", "lead", "--interval", "2"]).interval,
		]));
	`;
	const run = (env: NodeJS.ProcessEnv) =>
		JSON.parse(
			execFileSync(process.execPath, ["--input-type=module", "-e", code], {
				encoding: "utf8",
				env: paneChildEnv(env),
			}),
		) as number[];
	expect(run({ PI_AGENTS_PANE_INTERVAL: "5" })).toEqual([5, 2]);
	expect(run({ PI_AGENTS_PANE_INTERVAL: "" })).toEqual([2, 2]);
	const bad = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`const { main } = await import(${JSON.stringify(moduleUrl)}); main(["--scope", "lead"]);`,
		],
		{ encoding: "utf8", env: paneChildEnv({ PI_AGENTS_PANE_INTERVAL: "banana" }) },
	);
	expect(bad.status).toBe(2);
	expect(bad.stderr).toContain("PI_AGENTS_PANE_INTERVAL must be 0.25–3600 seconds");
});

function cli(...args: string[]) {
	return spawnSync(
		executable,
		["--scope", "lead", "--registry", dir, ...args],
		{ encoding: "utf8", cwd: tmpdir(), timeout: 3000, env: paneChildEnv() },
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
		{ encoding: "utf8", env: paneChildEnv() },
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
		{ stdio: ["ignore", "pipe", "pipe"], env: paneChildEnv() },
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

it("designates a lead in the panel without altering registry identity", () => {
	const v = {
		scope: "lead",
		leadState: "ambiguous",
		records: [
			{ id: "a", name: "alias", lead: true, state: "live" },
			{ id: "b", name: "lead", lead: true, state: "live" },
			{ id: "c", name: "helper", lead: false, state: "live" },
		],
	};
	const result = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify([pane.designateLead(${JSON.stringify(v)}),pane.designateLead(${JSON.stringify(v)},'c'),pane.designateLead(${JSON.stringify(v)},'missing')]));`,
		),
	);
	expect(result[0].records.map((row: { id: string }) => row.id)).toEqual([
		"b",
		"a",
		"c",
	]);
	expect(result[0].leadState).toBe("resolved");
	expect(result[1].records[0].id).toBe("c");
	expect(result[1].leadState).toBe("resolved");
	expect(result[2].leadState).toBe("unavailable");
	expect(result[2].records).toHaveLength(3);
});

it("revalidates the armed instance and expiry before closing", () => {
	const request = {
		id: "a",
		pid: 42,
		startedAt: 100,
		name: "agent",
		status: "waiting",
		session: "S",
		paneId: 4,
		expires: 1000,
	};
	const row = {
		id: "a",
		pid: 42,
		name: "agent",
		status: "waiting",
		navigation: { startedAt: 100, zellij: { sessionName: "S", paneId: 4 } },
	};
	const value = JSON.parse(
		evaluate(
			`const req=${JSON.stringify(request)},row=${JSON.stringify(row)};process.stdout.write(JSON.stringify([pane.closeConfirmationMatches(req,row,1000),pane.closeConfirmationMatches(req,row,1001),pane.closeConfirmationMatches(req,{...row,pid:43},999),pane.closeConfirmationMatches(req,{...row,navigation:{...row.navigation,startedAt:101}},999),pane.closeConfirmationMatches(req,undefined,999)]));`,
		),
	);
	expect(value).toEqual([true, false, false, false, false]);
});

it("rejects existing names and declared aliases across the registry", () => {
	record("root", { name: "elsewhere", declared_name: "reserved" });
	record("helper", {
		name: "different",
		spawn_name: "worker",
		namespace: "group",
	});
	const result = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(['reserved','worker','group','new-agent'].map(name=>pane.nameAvailable(${JSON.stringify(dir)},name))));`,
		),
	);
	expect(result).toEqual([false, false, false, true]);
});

it("rejects names reserved by the durable ownership journal and fails closed on malformed journal", () => {
	writeFileSync(
		join(dir, "namespace-owners.json"),
		JSON.stringify({ version: 1, owners: [{ name: "ReservedLead" }] }),
	);
	let result = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify([pane.nameAvailable(${JSON.stringify(dir)},'reservedlead'),pane.nameAvailable(${JSON.stringify(dir)},'other')]));`,
		),
	);
	expect(result).toEqual([false, true]);
	writeFileSync(join(dir, "namespace-owners.json"), "{");
	result = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(pane.nameAvailable(${JSON.stringify(dir)},'other')));`,
		),
	);
	expect(result).toBe(false);
});

it("includes Hub-normalized helper namespaces for a mixed-case scope", () => {
	record("root", { name: "Lead", declared_name: "Lead" });
	record("child", { namespace: "lead" });
	const result = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(pane.snapshot(${JSON.stringify(dir)},'Lead',()=> 'live')));`,
		),
	);
	expect(result.records.map((r: { id: string }) => r.id)).toEqual([
		"root",
		"child",
	]);
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

it.each([
	20, 27, 40,
])("labels lead and quit in the footer at width %i", (width) => {
	const view = { scope: "lead", leadState: "resolved", records: [] };
	const output = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, ${width}, 40, false, {enabled:true})));`,
		),
	) as string;
	const footer = output.trimEnd().split("\n").at(-1) ?? "";
	expect(footer).toContain("l:lead");
	expect(footer).toContain("q:quit");
	expect(footer.length).toBeLessThanOrEqual(width);
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

it.each([
	{ status: "running", rgb: "104;183;141" },
	{ status: "waiting", rgb: "167;152;215" },
	{ status: "done", rgb: "126;136;142" },
	{ status: "blocked", rgb: "205;154;34" },
	{ status: "stalled", rgb: "205;154;34" },
	{ status: "terminated", rgb: "234;127;129" },
	{ status: "unknown", rgb: "157;165;169" },
])("uses Hub dark-theme colour for $status without changing text or width", ({
	status,
	rgb,
}) => {
	const view = {
		scope: "demo",
		leadState: "resolved",
		records: [{ name: "agent", status }],
	};
	const output = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, 28, 40, true)));`,
		),
	) as string;
	const row = output.split("\n")[1] ?? "";
	expect(row.startsWith(`\x1b[38;2;${rgb}m`)).toBe(true);
	expect(row.endsWith("\x1b[0m")).toBe(true);
	const plain = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, 28, 40)));`,
		),
	) as string;
	expect(row.slice(`\x1b[38;2;${rgb}m`.length, -4)).toBe(plain.split("\n")[1]);
});

it("keeps selected two-line cards visible and maps both lines to the same agent", () => {
	const rows = Array.from({ length: 12 }, (_, i) => ({ id: `agent-${i}`, name: `agent-${i}-with-a-long-name`, status: "waiting", model: "provider/a-long-model" }));
	const results = JSON.parse(evaluate(`
		const rows = ${JSON.stringify(rows)};
		let offset = 0;
		const pages = rows.map(row => {
			const page = pane.pageRows(rows, row.id, offset, 7, 28);
			offset = page.offset;
			return { selected: row.id, lines: page.lines };
		});
		process.stdout.write(JSON.stringify(pages));
	`)) as { selected: string; lines: string[] }[];
	for (const { selected, lines } of results) {
		expect(lines.length).toBeLessThanOrEqual(7);
		expect(lines.filter((id) => id === selected)).toHaveLength(2);
		for (let i = 0; i < lines.length; i += 2) expect(lines[i]).toBe(lines[i + 1]);
	}
});

it("uses the unknown symbol for inherited property names", () => {
	const view = { scope: "demo", leadState: "resolved", records: [{ name: "agent", status: "constructor" }] };
	const output = JSON.parse(evaluate(
		`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, 80)));`,
	)) as string;
	expect(output.split("\n")[1]).toBe("? agent │ constructor");
});

it.each([
	28, 40, 80,
])("renders exact Hub-style compact rows at %i columns", (width) => {
	const view = {
		scope: "demo",
		leadState: "resolved",
		records: [
			{ name: "quartermaster", status: "running" },
			{ name: "reviewer", status: "waiting" },
		],
	};
	const output = evaluate(
		`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, ${width})));`,
	);
	expect(JSON.parse(output)).toBe(
		"demo · hub\nR quartermaster │ running\nW reviewer │ waiting\nq:quit\n",
	);
});

it.each([
	{ width: 32, line: "R very-long-name-for-an-agent" },
	{ width: 28, line: "R very-long-name-for-an-agen" },
	{ width: 20, line: "R very-long-name-for" },
	{ width: 12, line: "R very-long-" },
	{ width: 4, line: "R ve" },
])("truncates name before dropping status at $width columns", ({
	width,
	line,
}) => {
	const view = {
		scope: "demo",
		leadState: "resolved",
		records: [{ name: "very-long-name-for-an-agent", status: "running" }],
	};
	const output = JSON.parse(
		evaluate(
			`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, ${width})));`,
		),
	) as string;
	expect(output.split("\n")[1]).toBe(line);
});

it("retains heartbeat and model in JSON while omitting details from compact rows", () => {
	record("lead", { heartbeat: 1 });
	const view = JSON.parse(cli("--json").stdout);
	expect(view.records[0].heartbeat).toBe(1);
	expect(view.records[0].model).toBe("fixture/model");
	const output = cli("--once").stdout;
	expect(output).toContain("W lead │ waiting │ model");
	expect(output).not.toContain("fixture/model");
	expect(output).not.toContain("seen ");
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
	expect(lines).toHaveLength(3);
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
	expect(spawnSync(executable, args, { encoding: "utf8", env: paneChildEnv() }).status).toBe(2);
});

it.each([
	false,
	true,
])("restores terminal state and honors no-color=%s (isolated PTY)", (noColor) => {
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
args = [sys.argv[1], '--scope', 'lead', '--registry', sys.argv[2], '--interval', '10']
if sys.argv[3] == 'true': args.append('--no-color')
env = {k: v for k, v in os.environ.items() if k not in ('ZELLIJ', 'ZELLIJ_SESSION_NAME', 'ZELLIJ_PANE_ID')}
p = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, env=env)
data = b''
def until(needle):
    global data
    deadline = time.monotonic() + 3
    while needle not in data and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]: data += os.read(master, 65536)
    assert needle in data, repr(data)
try:
    until(b'q:quit')
    assert (b'\\x1b[38;2;' in data) == (sys.argv[3] == 'false')
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
			String(noColor),
		],
		{ encoding: "utf8", timeout: 10000, env: paneChildEnv() },
	);
	expect(output.trim()).toBe("restored");
});

it("keeps ambiguity visible in narrow headers", () => {
	for (const width of [20, 24, 28, 32]) {
		const view = {
			scope: "pi-tools-and-skills",
			leadState: "ambiguous",
			records: [],
		};
		const text = JSON.parse(
			evaluate(
				`process.stdout.write(JSON.stringify(pane.render(${JSON.stringify(view)}, ${width})));`,
			),
		) as string;
		expect(text.split("\n")[0]).toBe("hub (ambiguous)");
	}
});

it.each([
	"mouse",
	"keyboard",
	"close",
	"new",
	"new-cancel",
	"new-escape",
	"startup",
	"gone",
	"marker",
])("handles %s selection safely with a stub and restores the terminal", (method) => {
	const now = Date.now();
	const live = {
		pid: process.pid,
		startedAt: now - process.uptime() * 1000,
		heartbeat: now,
		cwd: "/work",
	};
	record("lead", { ...live, zellij: { sessionName: "fixture", paneId: 2 } });
	record("helper", {
		...live,
		namespace: "lead",
		zellij: { sessionName: "fixture", paneId: 17 },
	});
	if (method === "marker") writeFileSync(join(dir, "bad.json"), "{");
	const log = join(dir, "calls");
	const focused = join(dir, "focused");
	const stub = join(dir, "zellij");
	writeFileSync(
		stub,
		`#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n'); if(args.includes('focus-pane-id')) {fs.writeFileSync(${JSON.stringify(focused)},'17');} else if(args.includes('close-pane')) {fs.writeFileSync(${JSON.stringify(join(dir, "closed"))},'17');} else if(args.includes('new-pane')) {fs.writeFileSync(${JSON.stringify(join(dir, "created"))},'40');process.stdout.write('terminal_40\\n');} else if(args.includes('are-floating-panes-visible')) {process.stdout.write('false');} else { process.stdout.write(JSON.stringify([{id:99,tab_id:1,is_plugin:false,is_focused:!fs.existsSync(${JSON.stringify(focused)}),pane_cwd:'/view'},{id:2,tab_id:1,is_plugin:false,pane_cwd:'/work'},...(!fs.existsSync(${JSON.stringify(join(dir, "closed"))})?[{id:17,tab_id:1,is_plugin:false,pane_cwd:'/work'}]:[]),{id:8,tab_id:2,is_plugin:false,pane_cwd:'/work'},...(fs.existsSync(${JSON.stringify(join(dir, "created"))})?[{id:40,tab_id:1,is_plugin:false,is_floating:true,pane_cwd:'/work'}]:[])])); }`,
	);
	if (method === "startup") {
		const source = readFileSync(stub, "utf8");
		writeFileSync(
			stub,
			source.replace(
				"const fs=require('node:fs');",
				`const fs=require('node:fs'); if(!fs.existsSync(${JSON.stringify(join(dir, "inspect-started"))})){fs.writeFileSync(${JSON.stringify(join(dir, "inspect-started"))},'1');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,700);fs.writeFileSync(${JSON.stringify(join(dir, "inspect-finished"))},'1');}`,
			),
		);
	}
	chmodSync(stub, 0o755);
	const output = execFileSync(
		"python3",
		[
			"-c",
			`
import os, pty, subprocess, termios, fcntl, struct, select, time, sys
master, slave = pty.openpty()
before = termios.tcgetattr(slave)
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 5 if sys.argv[3]=='marker' else 20, 40, 0, 0))
env = dict(os.environ, ZELLIJ='0', ZELLIJ_SESSION_NAME='fixture', ZELLIJ_PANE_ID='99', PATH=sys.argv[2]+os.pathsep+os.environ['PATH'])
p = subprocess.Popen([sys.argv[1], '--scope', 'lead', '--registry', sys.argv[2], '--interval', '0.25'], stdin=slave, stdout=slave, stderr=slave, env=env)
data = b''
def until(needle):
    global data
    deadline = time.monotonic()+4
    while needle not in data and time.monotonic()<deadline:
        if select.select([master], [], [], 0.05)[0]: data += os.read(master,65536)
    assert needle in data, repr(data)
try:
    if sys.argv[3]=='startup':
        until(b'q:quit')
        deadline=time.monotonic()+3
        while not os.path.exists(os.path.join(sys.argv[2],'inspect-started')) and time.monotonic()<deadline: time.sleep(0.01)
        assert os.path.exists(os.path.join(sys.argv[2],'inspect-started'))
        assert not os.path.exists(os.path.join(sys.argv[2],'inspect-finished'))
        os.write(master,b'c')
        time.sleep(0.1)
        assert not os.path.exists(os.path.join(sys.argv[2],'inspect-finished'))
        os.write(master,b'\\r')
        assert not os.path.exists(os.path.join(sys.argv[2],'inspect-finished'))
    until(b'l:lead q:quit')
    if sys.argv[3]=='startup':
        time.sleep(0.3)
        assert not os.path.exists(os.path.join(sys.argv[2],'closed')), 'startup replay closed a pane'
    assert b'\\x1b[?1000h' in data and b'\\x1b[?1006h' in data
    assert b'\\x1b[7m' in data
    assert b'\\x1b[?2004h' in data
    flag=os.path.join(sys.argv[2],'focused')
    if sys.argv[3]=='startup':
        os.write(master,b'j')
        time.sleep(0.15)
        data=b''
        os.write(master,b'c')
        until(b'Close #17 [W] Y/n helper')
        os.write(master,b'y')
        data=b''
        until(b'Pane closed: helper')
    elif sys.argv[3] in ('new','new-cancel','new-escape'):
        data=b''
        os.write(master,b'n')
        until(b'Name:')
        os.write(master,b'cyq-worker')
        until(b'Name: cyq-worker')
        assert p.poll() is None and not os.path.exists(os.path.join(sys.argv[2],'closed')), 'name text activated an action'
        if sys.argv[3]=='new-escape':
            os.write(master,b'\\x1b')
            until(b'New agent cancelled')
        else:
            os.write(master,b'\\r')
            if sys.argv[3]=='new':
                time.sleep(0.03)
                os.write(master,b'\\r')
            until(b'Default model? Y/n cyq-worker')
            assert not os.path.exists(os.path.join(sys.argv[2],'created')), 'launched before confirmation'
            if sys.argv[3]=='new':
                until(b'Wait; Enter confirms')
                assert not os.path.exists(os.path.join(sys.argv[2],'created')), 'double Enter launched agent'
                time.sleep(0.35)
                os.write(master,b'\\r')
                until(b'Requested: cyq-worker')
            else:
                os.write(master,b'n')
                until(b'New agent cancelled')
        if sys.argv[3]!='new': assert not os.path.exists(os.path.join(sys.argv[2],'created')), 'cancelled launch'

    elif sys.argv[3]=='close':
        os.write(master,b'j')
        time.sleep(0.15)
        data=b''
        os.write(master,b'cy')
        until(b'Use separate confirmation keys')
        os.write(master,b'y')
        time.sleep(0.15)
        assert not os.path.exists(os.path.join(sys.argv[2],'closed')), 'combined input left an arm'
        os.write(master,b'c\\r')
        until(b'Use separate confirmation keys')
        assert not os.path.exists(os.path.join(sys.argv[2],'closed')), 'combined c/Enter closed pane'
        os.write(master,b'abc')
        os.write(master,b'yes')
        time.sleep(0.15)
        assert not os.path.exists(os.path.join(sys.argv[2],'closed')), 'pasted text closed pane'
        data=b''
        os.write(master,b'c')
        until(b'Close #17 [W] Y/n helper')
        os.write(master,b'\\r')
        data=b''
        until(b'Pane closed: helper')
    elif sys.argv[3]=='gone':
        os.write(master,b'j')
        time.sleep(0.15)
        os.unlink(os.path.join(sys.argv[2],'helper.json'))
        data=b''
        until(b'selected agent left')
        os.write(master,b'\\r')
        time.sleep(0.4)
        assert not os.path.exists(flag), 'selection silently migrated'
    elif sys.argv[3]=='marker':
        os.write(master,b'\\x1b[<0;8;3M')
        time.sleep(0.4)
        assert not os.path.exists(flag), 'marker click focused an agent'
    else:
        os.write(master, b'\\x1b[<0;8;3M' if sys.argv[3]=='mouse' else b'j\\r')
        deadline=time.monotonic()+4
        while not os.path.exists(flag) and time.monotonic()<deadline: time.sleep(0.02)
        assert os.path.exists(flag)
        # Allow the async navigation check to observe the changed focus.
        time.sleep(0.6)
        while select.select([master],[],[],0)[0]: os.read(master,65536)
        # Unchanged polls must not repaint the terminal.
        assert not select.select([master],[],[],0.8)[0], 'repainted unchanged frame'
        # Real registry changes still appear while the floating agent has focus.
        import json
        path=os.path.join(sys.argv[2],'helper.json')
        with open(path) as f: record=json.load(f)
        record['model']='fixture/updated-model'
        with open(path,'w') as f: json.dump(record,f)
        data=b''
        until(b'updated-model')
        assert b'\\x1b[?1000l' not in data, 'mouse reporting disabled while unfocused'
        os.unlink(flag)
    os.write(master,b'q')
    until(b'\\x1b[?1000l')
    until(b'\\x1b[?1006l')
    until(b'\\x1b[?2004l')
    assert p.wait(timeout=3)==0
    assert termios.tcgetattr(slave)==before
    print('focused and restored')
finally:
    if p.poll() is None: p.kill(); p.wait()
    os.close(master); os.close(slave)
`,
			executable,
			dir,
			method,
		],
		{ encoding: "utf8", timeout: 12000, env: paneChildEnv() },
	);
	expect(output.trim()).toBe("focused and restored");
	const calls = readFileSync(log, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as string[]);
	const launches = calls.filter((args) => args.includes("new-pane"));
	expect(launches).toHaveLength(method === "new" ? 1 : 0);
	if (method === "new") {
		expect(launches[0]).toContain("--floating");
		expect(launches[0]).toContain("PI_PANOPTICON_NAMESPACE=lead");
		expect(launches[0]).not.toContain("--model");
	}
	expect(calls.filter((args) => args.includes("close-pane"))).toEqual(
		method === "close" || method === "startup"
			? [
					[
						"--session",
						"fixture",
						"action",
						"close-pane",
						"--pane-id",
						"terminal_17",
					],
				]
			: [],
	);
	expect(calls.filter((args) => args.includes("focus-pane-id"))).toEqual(
		method === "gone" ||
			method === "new" ||
			method === "new-cancel" ||
			method === "new-escape" ||
			method === "marker" ||
			method === "close" ||
			method === "startup"
			? []
			: [["--session", "fixture", "action", "focus-pane-id", "terminal_17"]],
	);
});

it("pauses startup redraws while input stays responsive, then resumes polling", () => {
	record("lead");
	const stub = join(dir, "zellij");
	writeFileSync(stub, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify([{id:99,tab_id:1,is_plugin:false,is_focused:true}]));\n`);
	chmodSync(stub, 0o755);
	const output = execFileSync("python3", ["-c", `
import os, pty, subprocess, select, time, json, sys, fcntl, termios, struct
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
env = dict(os.environ, PI_AGENTS_PANE_STARTUP_DELAY='2', ZELLIJ='0', ZELLIJ_SESSION_NAME='fixture', ZELLIJ_PANE_ID='99', PATH=sys.argv[2]+os.pathsep+os.environ['PATH'])
p = subprocess.Popen([sys.argv[1], '--scope', 'lead', '--registry', sys.argv[2], '--interval', '0.25'], stdin=slave, stdout=slave, stderr=slave, env=env)
data=b''
def until(text):
    global data
    deadline=time.monotonic()+4
    while text not in data and time.monotonic()<deadline:
        if select.select([master],[],[],0.05)[0]: data+=os.read(master,65536)
    assert text in data, repr(data)
def update(model):
    path=os.path.join(sys.argv[2],'lead.json')
    with open(path) as f: row=json.load(f)
    row['model']=model
    with open(path,'w') as f: json.dump(row,f)
try:
    until(b'model')
    until(b'\\x1b[?1000h')
    update('fixture/input-update')
    assert not select.select([master],[],[],0.5)[0], 'automatic startup redraw'
    data=b''
    os.write(master,b'j')
    until(b'input-update')
    update('fixture/poll-update')
    data=b''
    assert not select.select([master],[],[],0.3)[0], 'input cancelled startup delay'
    until(b'poll-update')
    update('fixture/next-poll')
    data=b''
    until(b'next-poll')
    os.write(master,b'q')
    assert p.wait(timeout=2)==0
    print('ok')
finally:
    if p.poll() is None: p.kill(); p.wait()
    os.close(master); os.close(slave)
`, executable, dir], { encoding: "utf8", timeout: 10000, env: paneChildEnv() });
	expect(output.trim()).toBe("ok");
});

it.each([undefined, "", "0", "2.5", "-1", "NaN", "Infinity", "3601"])("validates startup delay %s", (value) => {
	const env = paneChildEnv();
	if (value === undefined) delete env.PI_AGENTS_PANE_STARTUP_DELAY;
	else env.PI_AGENTS_PANE_STARTUP_DELAY = value;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
		const { parseArgs } = await import(${JSON.stringify(moduleUrl)});
		process.stdout.write(String(parseArgs(["--scope", "lead"]).startupDelay));
	`], { encoding: "utf8", env });
	if (value === undefined || value === "" || value === "0" || value === "2.5") {
		expect(result.status).toBe(0);
		expect(Number(result.stdout)).toBe(value ? Number(value) : 20);
	} else {
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("PI_AGENTS_PANE_STARTUP_DELAY must be 0–3600 seconds");
	}
});

it("prints help from a foreign cwd", () => {
	const result = spawnSync(executable, ["--help"], {
		encoding: "utf8",
		cwd: tmpdir(),
		env: paneChildEnv(),
	});
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("--scope");
});

it("retries unreadable registry and exits cleanly on SIGTERM", async () => {
	rmSync(dir, { recursive: true });
	const child = spawn(
		executable,
		["--scope", "lead", "--registry", dir, "--interval", "0.25"],
		{ stdio: ["ignore", "pipe", "pipe"], env: paneChildEnv() },
	);
	let output = "";
	let signalled = false;
	const done = new Promise<number | null>((resolveDone, reject) => {
		child.once("error", reject);
		child.once("exit", resolveDone);
	});
	const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
	child.stdout.on("data", (data: Buffer) => {
		output += data.toString();
		if (
			output.includes("registry unreadable") &&
			!output.includes("lead · hub (unavailable)")
		) {
			mkdirSync(dir, { recursive: true });
			record("lead");
		}
		if (!signalled && output.includes("lead · hub (unavailable)")) {
			signalled = true;
			child.kill("SIGTERM");
		}
	});
	try {
		expect(await done).toBe(0);
	} finally {
		clearTimeout(timeout);
		child.kill("SIGKILL");
	}
	expect(output).toContain("registry unreadable");
	expect(output).toContain("lead · hub (unavailable)");
});

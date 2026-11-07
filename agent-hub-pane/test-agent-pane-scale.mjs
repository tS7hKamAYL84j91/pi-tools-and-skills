#!/usr/bin/env node
/** Opt-in owner-requested scale test. One disposable session, real Termwright input,
 * 11 concurrent Hub panes and 40 tiny standing fixture processes. No model calls.
 */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { launchTerminal } from "@termwright/driver";
import { createNavigator } from "./pi-agents-pane-navigation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const counts = [10, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
const groups = counts.map((count, i) => ({ scope: `group-${String(i).padStart(2, "0")}`, count }));
const session = `pi-hub-scale-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), "pi-hub-scale-"));
const registry = join(dir, "agents"), bin = join(dir, "bin");
mkdirSync(registry); mkdirSync(bin);
// Deliberate allowlist: no provider/Matrix credentials or caller's Zellij identity.
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: homedir(), TERM: "xterm-256color", SHELL: "/bin/sh", PI_AGENTS_PANE_STARTUP_DELAY: "0" };
if (process.env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
const zellij = spawnSync("which", ["zellij"], { env, encoding: "utf8" }).stdout.trim();
assert(zellij, "zellij executable required");
env.PATH = `${bin}:${env.PATH}`;
const execute = promisify(execFile);
const run = async (args) => (await execute(zellij, args, { env, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout;
const action = (...args) => run(["--session", session, "action", ...args]);
const list = async () => JSON.parse(await action("list-panes", "--json", "--all"));
const screen = (pane) => action("dump-screen", "--pane-id", `terminal_${pane.id}`);
async function floatingVisible(tabId) {
	try {
		const value = (await action("are-floating-panes-visible", "--tab-id", String(tabId))).trim();
		assert(value === "true" || value === "false", "unknown floating-layer state");
		return value === "true";
	} catch (error) {
		if ((error.code === 2 && error.stdout === "" && error.stderr?.trim() === "false") || (error.code === 1 && error.stdout?.trim() === "false")) return false;
		throw error;
	}
}
const deadline = Date.now() + 150_000;
async function until(check, label, timeout = 15000) {
	const end = Math.min(deadline, Date.now() + timeout);
	while (Date.now() < end) {
		const value = await check();
		if (value) return value;
		await delay(250);
	}
	throw new Error(`timed out: ${label}`);
}
function proc(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
		return { state: fields[0], cpuMs: (Number(fields[11]) + Number(fields[12])) * 10 };
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
const queryLog = join(dir, "queries.jsonl");
const queryCount = () => readFileSync(queryLog, "utf8").trim().split("\n").filter(Boolean).length;
let terminal, summary, created = false;
const ownedPids = [];
try {
	const version = (await run(["--version"])).trim();
	writeFileSync(join(dir, "config.kdl"), "session_serialization false\n");
	writeFileSync(queryLog, "");
	// Instrument only fixture Hub CLI calls; don't save command output or process argv.
	const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	writeFileSync(join(bin, "zellij"), `#!/bin/sh\nprintf '{"action":"%s","format":"%s","pane":"%s"}\\n' "$4" "$5" "$ZELLIJ_PANE_ID" >> ${shellQuote(queryLog)}\nexec ${shellQuote(zellij)} "$@"\n`);
	chmodSync(join(bin, "zellij"), 0o755);
	const fixture = join(dir, "agent.py"), hub = join(dir, "hub.mjs");
	// Small standing processes, not forty V8 cold starts or model executors.
	writeFileSync(fixture, `import json, os, sys, time
from pathlib import Path
scope, index = sys.argv[1], int(sys.argv[2])
name = scope if index == 1 else scope + '-a' + str(index).zfill(2)
record = dict(id=name, name=name, pid=os.getpid(), startedAt=int(time.time()*1000), cwd=os.getcwd(), model='fixture/model', status='waiting', zellij=dict(sessionName=os.environ['ZELLIJ_SESSION_NAME'], paneId=int(os.environ['ZELLIJ_PANE_ID'])))
record['declared_name' if index == 1 else 'namespace'] = scope
path = Path(${JSON.stringify(registry)}) / (name + '.json')
for tick in range(600):
    if tick % 4 == 0:
        record['heartbeat'] = int(time.time()*1000)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(record)); temporary.replace(path)
    print('fixture ' + name + ' tick ' + str(tick), flush=True)
    time.sleep(0.25)
`);
	writeFileSync(hub, `import {writeFileSync} from 'node:fs';import {join} from 'node:path';import {main} from ${JSON.stringify(pathToFileURL(join(root, "agent-hub-pane/pi-agents-pane.mjs")).href)};
const scope=process.argv[2];writeFileSync(join(${JSON.stringify(dir)},scope+'.pid'),String(process.pid));main(['--scope',scope,'--registry',${JSON.stringify(registry)}]);\n`);
	const quotedNode = JSON.stringify(process.execPath), cwd = JSON.stringify(dir);
	const tabs = groups.map(({ scope, count }, i) => `tab name="${scope}" ${i === 0 ? "focus=true" : ""} {
 pane name="hub-${scope}" command=${quotedNode} cwd=${cwd} { args ${JSON.stringify(hub)} "${scope}"; }
 floating_panes {
 ${Array.from({ length: count }, (_, j) => `pane name="agent-${scope}-${j + 1}" command="python3" cwd=${cwd} { args ${JSON.stringify(fixture)} "${scope}" "${j + 1}"; width "60%"; height "60%"; x "30%"; y "20%"; }`).join("\n")}
 }
}`).join("\n");
	writeFileSync(join(dir, "layout.kdl"), `layout {\n${tabs}\n}\n`);
	const started = performance.now();
	created = true;
	await run(["--config", join(dir, "config.kdl"), "--layout", join(dir, "layout.kdl"), "attach", "--create-background", session]);
	terminal = await launchTerminal({ command: [zellij, "--config", join(dir, "config.kdl"), "attach", session], cwd: dir, columns: 120, rows: 40, envMode: "replace", env });
	const records = await until(() => {
		const rows = readdirSync(registry).filter((name) => name.endsWith(".json")).map((name) => {
			try { return JSON.parse(readFileSync(join(registry, name), "utf8")); } catch { return null; }
		});
		return rows.length === 40 && rows.every(Boolean) ? rows : null;
	}, "40 agent records");
	ownedPids.push(...records.map((r) => r.pid));
	await until(() => groups.every((group) => readdirSync(dir).includes(`${group.scope}.pid`)), "11 Hub process receipts");
	ownedPids.push(...groups.map((group) => Number(readFileSync(join(dir, `${group.scope}.pid`), "utf8"))));
	const initial = await until(async () => {
		const panes = (await list()).filter((p) => !p.is_plugin);
		return panes.length === 51 && panes.every((p) => !p.exited) ? panes : null;
	}, "51 live fixture terminals", 30000);
	const readyAt = [];
	for (const group of groups) {
		group.hub = initial.find((p) => p.title === `hub-${group.scope}`);
		assert(group.hub);
		group.rows = records.filter((r) => r.declared_name === group.scope || r.namespace === group.scope).sort((a, b) => a.name.localeCompare(b.name));
		assert.equal(group.rows.length, group.count);
		for (const row of group.rows) assert(initial.some((p) => p.id === row.zellij.paneId && p.tab_id === group.hub.tab_id && p.is_floating));
		await until(async () => (await screen(group.hub)).includes("l:lead q:quit"), `interactive ${group.scope}`, 30000);
		readyAt.push(Math.round(performance.now() - started));
	}
	const hubPids = groups.map((group) => Number(readFileSync(join(dir, `${group.scope}.pid`), "utf8")));
	const cpuBefore = hubPids.reduce((sum, pid) => sum + proc(pid).cpuMs, 0);
	const queriesBefore = queryCount();
	const producer = initial.find((p) => p.id === groups[0].rows[0].zellij.paneId && !p.is_plugin);
	const beforeOutput = await screen(producer);
	await delay(2500); // Includes a full default 2-second registry poll in every pane.
	assert.equal(queryCount(), queriesBefore, "steady-state Hub query storm");
	const idleCpuMs = hubPids.reduce((sum, pid) => sum + proc(pid).cpuMs, 0) - cpuBefore;
	assert.notEqual(await screen(producer), beforeOutput, "fixture output stopped");

	async function focusHub(group) {
		await action("go-to-tab-by-id", String(group.hub.tab_id));
		await action("focus-pane-id", `terminal_${group.hub.id}`);
		await until(async () => !(await floatingVisible(group.hub.tab_id)), "Hub layer visible");
		await terminal.waitUntil(({ screen }) => screen.text(), {
			until: (text) => text.includes(`${group.scope} · hub`) && text.includes("l:lead q:quit") && !text.includes("fixture group-"),
			description: `unobscured ${group.scope} Hub`,
		});
	}
	async function focused(row) {
		// Observe the display first: polling expensive metadata during the action
		// would itself create contention and distort the latency measurement.
		await terminal.waitForText(`fixture ${row.name} tick`);
		const displayedAt = performance.now();
		const pane = (await list()).find((p) => !p.is_plugin && p.id === row.zellij.paneId);
		assert(pane?.is_focused && await floatingVisible(pane.tab_id), `visible focus receipt ${row.name}`);
		return displayedAt;
	}
	const focusLatencyMs = [];
	for (const group of groups) {
		await focusHub(group);
		const text = terminal.screen().text();
		for (const row of group.rows) assert(text.includes(row.name), `missing visible row ${row.name}`);
		for (const other of groups) if (other !== group) assert(!text.includes(`W ${other.scope}`), "cross-scope row leak");
		await terminal.type("k".repeat(group.count)); // explicit selection reset, not startup ordering
		const last = group.rows.at(-1);
		const begin = performance.now();
		if (group.count > 1) await terminal.type("j".repeat(group.count - 1));
		await terminal.press("Enter");
		focusLatencyMs.push(Math.round((await focused(last)) - begin));
	}
	// Dense paging and real mouse reports through Termwright, not CLI input injection.
	const dense = groups[0];
	await focusHub(dense);
	await terminal.resize({ columns: 30, rows: 18 });
	await terminal.waitUntil(({ screen }) => screen.text().split("\n"), {
		until: (lines) => lines.some((line, i) => line.includes(`│W ${dense.rows.at(-1).name}`) && !line.includes("waiting") && lines[i + 1]?.includes("waiting")),
		description: "application redrew the tenth agent as a narrow two-line card",
	});
	const mouseStarted = performance.now();
	await terminal.getByScreenText(`W ${dense.rows.at(-1).name}`).click();
	const mouseLatencyMs = Math.round((await focused(dense.rows.at(-1))) - mouseStarted);
	await terminal.resize({ columns: 120, rows: 40 });
	await focusHub(dense);
	const advisoryStart = queryCount();
	const closeArmStarted = performance.now();
	await terminal.type("c");
	await terminal.waitForText(`Close #${dense.rows.at(-1).zellij.paneId}`);
	const closeArmingMs = Math.round(performance.now() - closeArmStarted);
	const advisoryCalls = () => readFileSync(queryLog, "utf8").trim().split("\n").slice(advisoryStart).map((line) => JSON.parse(line));
	await until(() => advisoryCalls().some((call) => call.action === "list-panes" && call.format === "--state"), "cheap periodic modal inspection", 3000);
	await terminal.type("n");
	await terminal.waitForText("Close cancelled");
	const createArmStarted = performance.now();
	await terminal.type("n");
	await terminal.waitForText("Name:");
	const createArmingMs = Math.round(performance.now() - createArmStarted);
	await terminal.press("Escape");
	await terminal.waitForText("New agent cancelled");
	const advisoryQueries = advisoryCalls();
	assert(advisoryQueries.some((call) => call.action === "list-tabs"), "cheap advisory path not exercised");
	assert.equal(advisoryQueries.filter((call) => call.action === "list-panes" && call.format === "--json").length, 2, "only the two arming operations may use full metadata; modal checks must stay cheap");
	const metadataCalls = [];
	const inspector = createNavigator({ sessionName: session, paneId: dense.hub.id }, async (args, { signal }) => {
		metadataCalls.push(args);
		return (await execute(zellij, args, { env, signal, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout;
	});
	const metadataStarted = performance.now();
	assert.equal((await inspector.inspect(undefined, true))?.own.is_focused, true);
	const advisoryMetadataMs = Math.round(performance.now() - metadataStarted);
	assert.equal(metadataCalls.length, 2);
	assert(!metadataCalls.some((args) => args.includes("--all")));
	assert.equal((await list()).filter((p) => !p.is_plugin && !p.exited).length, 51, "cancel changed fixture population");
	summary = { version, driver: "Termwright", concurrentHubPanes: 11, agentsPerPane: counts, concurrentFixtureAgents: 40, firstObservedReadyMs: readyAt, idleWindowMs: 2500, idleZellijQueries: 0, totalHubIdleCpuMs: idleCpuMs, keyboardFocusLatencyMs: focusLatencyMs, denseNarrowMouseLatencyMs: mouseLatencyMs, closeArmingMs, createArmingMs, advisoryMetadataMs, modalFullScans: 0, verified: ["all group memberships and live processes", "all 40 rows visible at full size", "keyboard focus and displayed target in every group", "dense narrow paging and mouse focus", "modal checks use cheap metadata; arming retains full validation; cancellation preserves all 51 terminals"], cleanup: "passed" };
} finally {
	try {
		if (created) {
			await run(["kill-session", session]);
			let inaccessible = false;
			try { await list(); } catch (error) { inaccessible = typeof error.code === "number" && error.code !== 0; }
			assert(inaccessible, "scratch session removal unverified");
		}
	} finally {
		try {
			await terminal?.close();
			const stopped = () => ownedPids.every((pid) => { const state = proc(pid); return !state || ["Z", "X", "x"].includes(state.state); });
			const cleanupDeadline = Date.now() + 5000;
			while (!stopped() && Date.now() < cleanupDeadline) await delay(75);
			assert(stopped(), "fixture processes survived session cleanup");
		} finally { rmSync(dir, { recursive: true, force: true }); }
	}
}
process.stdout.write(`${JSON.stringify(summary)}\n`);

#!/usr/bin/env node
/** Real native collector + fixed WASI views. One disposable session; no live config. */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { launchTerminal } from "@termwright/driver";

const here = dirname(fileURLToPath(import.meta.url));
const wasm = resolve(here, "target/wasm32-wasip1/release/pi-shared-hub.wasm");
const indexer = resolve(here, "target/release/pi-hub-index");
const counts = process.argv.includes("--scale")
	? [10, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5]
	: [2, 1, 3];
const groups = counts.map((count, i) => ({
	scope: `group-${String(i).padStart(2, "0")}`,
	count,
}));
const dir = mkdtempSync(join(tmpdir(), "nhv-")),
	session = `hv-${randomUUID().slice(0, 8)}`;
const registry = join(dir, "agents"),
	output = join(dir, "views");
mkdirSync(registry, { mode: 0o700 });
const env = {
	PATH: process.env.PATH ?? "/usr/bin:/bin",
	TERM: "xterm-256color",
	SHELL: "/bin/sh",
};
for (const [key, name] of Object.entries({
	HOME: "h",
	XDG_CACHE_HOME: "c",
	XDG_CONFIG_HOME: "cfg",
	XDG_DATA_HOME: "d",
	XDG_RUNTIME_DIR: "r",
	ZELLIJ_SOCKET_DIR: "s",
	TMPDIR: "t",
})) {
	env[key] = join(dir, name);
	mkdirSync(env[key], { mode: 0o700 });
}
const zellij = spawnSync("which", ["zellij"], {
	env,
	encoding: "utf8",
}).stdout.trim();
const execute = promisify(execFile);
const run = async (args) =>
	(
		await execute(zellij, args, {
			env,
			cwd: dir,
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 1024 * 1024,
		})
	).stdout;
const action = (...args) => run(["--session", session, "action", ...args]);
const list = async () =>
	JSON.parse(await action("list-panes", "--json", "--all"));
async function until(check, label, timeout = 15000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await check();
		if (result) return result;
		await delay(100);
	}
	throw new Error(`timed out: ${label}`);
}
function proc(pid) {
	try {
		const s = readFileSync(`/proc/${pid}/stat`, "utf8")
			.split(")")
			.at(-1)
			.trim()
			.split(/\s+/);
		return { state: s[0], start: s[19] };
	} catch (e) {
		if (e.code === "ENOENT") return null;
		throw e;
	}
}
const writerArgs = [
	"--registry",
	registry,
	"--output",
	output,
	...groups.flatMap((g) => ["--scope", g.scope]),
];
let terminal,
	second,
	started = false,
	summary;
const pids = [];
try {
	assert(
		existsSync(wasm) && existsSync(indexer),
		"build native indexer and WASI view first",
	);
	const prepared = JSON.parse(
		(
			await execute(indexer, [...writerArgs, "--prepare"], {
				env,
				cwd: dir,
				timeout: 5000,
			})
		).stdout,
	);
	assert.equal(prepared.registryReads, 0);
	for (const group of groups)
		group.directory = prepared.scopes.find(
			(s) => s.scope === group.scope,
		).directory;
	writeFileSync(join(dir, "phase"), "one");
	writeFileSync(
		join(dir, "agent.py"),
		`import json, os, sys, time
from pathlib import Path
scope,index=sys.argv[1],int(sys.argv[2]);name=scope if index==1 else scope+'-a'+str(index).zfill(2)
root=Path(${JSON.stringify(dir)});path=root/'agents'/(name+'.json')
row=dict(id=name,name=name,pid=os.getpid(),startedAt=int(time.time()*1000),cwd=str(root),status='waiting')
row['declared_name' if index==1 else 'namespace']=scope
for tick in range(180):
 row['heartbeat']=int(time.time()*1000);row['model']='fixture/model-'+(root/'phase').read_text().strip()
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(row));temp.chmod(0o600);temp.replace(path)
 print('fixture '+name+' tick '+str(tick),flush=True);time.sleep(1)
`,
	);
	writeFileSync(
		join(dir, "config.kdl"),
		`session_serialization false
mirror_session false
show_release_notes false
show_startup_tips false
keybinds {
 shared_except "locked" {
  bind "F6" { GoToNextTab; }
  bind "F7" { ToggleFloatingPanes; }
  bind "F8" { MoveTab "Left"; }
  bind "F9" { CloseTab; }
 }
}
`,
	);
	const agent = (scope, index) =>
		`pane name="agent-${scope}-${index}" command="python3" cwd=${JSON.stringify(dir)} { args ${JSON.stringify(join(dir, "agent.py"))} "${scope}" "${index}"; }`;
	writeFileSync(
		join(dir, "layout.kdl"),
		`layout {
 tab name="hub-data" focus=true {
  pane name="hub-indexer" command=${JSON.stringify(indexer)} cwd=${JSON.stringify(dir)} { args ${writerArgs.map(JSON.stringify).join(" ")}; }
 }
}
`,
	);
	for (const g of groups)
		writeFileSync(
			join(dir, `${g.scope}.kdl`),
			`layout { tab name="${g.scope}" hide_floating_panes=true {
 pane split_direction="vertical" {
  ${agent(g.scope, 1)}
  pane name="view-${g.scope}" size=36 cwd=${JSON.stringify(g.directory)} {
   plugin location=${JSON.stringify(`file:${wasm}`)} cwd=${JSON.stringify(g.directory)} { scope "${g.scope}"; }
  }
 }
 ${g.count > 1 ? `floating_panes {\n${Array.from({ length: g.count - 1 }, (_, j) => agent(g.scope, j + 2)).join("\n")}\n}` : ""}
}
}
`,
		);
	terminal = await launchTerminal({
		command: [
			zellij,
			"--config",
			join(dir, "config.kdl"),
			"--session",
			session,
		],
		cwd: dir,
		columns: 140,
		rows: 40,
		envMode: "replace",
		env,
	});
	started = true;
	await terminal.waitForText("Pane #1");
	await action("new-tab", "--layout", join(dir, "layout.kdl"));
	for (const g of groups)
		await action(
			"new-tab",
			"--cwd",
			g.directory,
			"--layout",
			join(dir, `${g.scope}.kdl`),
		);
	await until(async () => {
		if (terminal.screen().text().includes("q Enter stops")) return true;
		await terminal.press("F6");
		return false;
	}, "collector control tab");
	await until(
		() =>
			readdirSync(registry).filter((n) => n.endsWith(".json")).length ===
			counts.reduce((a, b) => a + b, 0),
		"all agent writers",
	);
	for (const file of readdirSync(registry).filter((n) => n.endsWith(".json")))
		pids.push(JSON.parse(readFileSync(join(registry, file), "utf8")).pid);
	const owner = readFileSync(join(output, ".owner"), "utf8");
	const writerPid = Number(/pid=(\d+)/.exec(owner)?.[1]);
	assert(Number.isSafeInteger(writerPid));
	pids.push(writerPid);
	const writerStart = proc(writerPid)?.start;
	assert(writerStart);
	const initial = await list(),
		writerPane = initial.find((p) => !p.is_plugin && p.title === "hub-indexer");
	assert(writerPane);
	const stats = async () => {
		const screen = await action(
			"dump-screen",
			"--pane-id",
			`terminal_${writerPane.id}`,
		);
		const m = [...screen.matchAll(/scan=(\d+) reads=(\d+) records=(\d+)/g)].at(
			-1,
		);
		return m ? m.slice(1).map(Number) : null;
	};
	const expected = counts.reduce((a, b) => a + b, 0);
	await until(async () => {
		const s = await stats();
		return s?.[2] === expected;
	}, "native collector snapshot");
	const duplicate = await execute(indexer, writerArgs, {
		env,
		cwd: dir,
		timeout: 5000,
	}).then(
		() => ({ failed: false }),
		() => ({ failed: true }),
	);
	assert(duplicate.failed, "second collector accepted same output");
	const before = await stats();
	await delay(2500);
	const after = await stats();
	assert(after[0] > before[0]);
	assert.equal(
		after[1] - before[1],
		expected * (after[0] - before[0]),
		"collector work multiplied with views",
	);
	const geometry = (p) => [p.pane_x, p.pane_y, p.pane_columns, p.pane_rows];
	for (const g of groups) {
		g.view = initial.find((p) => p.is_plugin && p.title === `view-${g.scope}`);
		assert(g.view);
	}
	const latencies = [];
	for (const g of groups) {
		const begin = performance.now();
		await terminal.press("F6");
		await terminal.waitForText(`Hub: ${g.scope} (read-only)`, {
			timeout: 5000,
		});
		await terminal.waitForText("model-one", { timeout: 5000 });
		latencies.push(Math.round(performance.now() - begin));
		const text = terminal.screen().text();
		assert(
			!/asks permission|Allow\?/.test(text),
			"read-only view requested host permissions",
		);
		assert(!text.includes("Snapshot unavailable"));
		for (const other of groups)
			if (other !== g)
				assert(!text.includes(`W ${other.scope}`), "scope leakage");
		const current = await list();
		for (const pane of initial)
			assert.deepEqual(
				geometry(
					current.find(
						(p) => p.is_plugin === pane.is_plugin && p.id === pane.id,
					),
				),
				geometry(pane),
				"fixed layout moved or resized",
			);
		const frame = JSON.parse(
			readFileSync(join(g.directory, "snapshot.json"), "utf8"),
		);
		assert.equal(frame.scope, g.scope);
		assert.equal(frame.rows.length, g.count);
		assert(frame.rows.every((r) => r.state === "live"));
		assert(
			frame.rows.every(
				(r) =>
					!Object.hasOwn(r, "cwd") &&
					!Object.hasOwn(r, "task") &&
					!Object.hasOwn(r, "sessionFile"),
			),
			"private canonical fields copied",
		);
	}
	const selected = `${groups.at(-1).scope}-a02`;
	await terminal
		.getByScreenText(`Hub: ${groups.at(-1).scope} (read-only)`)
		.click();
	await terminal.type("j");
	await terminal.waitForText(`>W ${selected}`);
	// Fixed scope stays correct after tab reorder: no ID/position move API involved.
	await terminal.press("F8");
	await terminal.waitForText(`Hub: ${groups.at(-1).scope} (read-only)`);
	assert(
		(await list()).some((p) => p.is_plugin && p.id === groups.at(-1).view.id),
	);
	await terminal.waitForText(`>W ${selected}`);
	writeFileSync(join(dir, "phase"), "two");
	await terminal.waitForText("model-two", { timeout: 6000 });
	// A second UI client consumes the same scoped files, not another registry scan.
	second = await launchTerminal({
		command: [zellij, "--config", join(dir, "config.kdl"), "attach", session],
		cwd: dir,
		columns: 140,
		rows: 40,
		envMode: "replace",
		env,
	});
	await until(async () => {
		if (second.screen().text().includes("Hub: group-")) return true;
		await second.press("F6");
		return false;
	}, "second client scoped view");
	assert.equal(
		Number(/pid=(\d+)/.exec(readFileSync(join(output, ".owner"), "utf8"))?.[1]),
		writerPid,
	);
	const twoBefore = await stats();
	await delay(2300);
	const twoAfter = await stats();
	assert.equal(
		twoAfter[1] - twoBefore[1],
		expected * (twoAfter[0] - twoBefore[0]),
	);
	await second.press("Control+o");
	await delay(50);
	await second.press("d");
	await second.waitForExit({ timeout: 5000 });
	await second.close();
	second = undefined;
	// Join, namespace move, rename and unregister must reach the actual views.
	const show = async (scope) =>
		until(async () => {
			if (terminal.screen().text().includes(`Hub: ${scope} (read-only)`))
				return true;
			await terminal.press("F6");
			return false;
		}, `show ${scope}`);
	const transient = join(registry, "transient.json");
	const row = {
		id: "transient",
		name: "transient",
		pid: process.pid,
		startedAt: Date.now(),
		namespace: groups[0].scope,
		status: "waiting",
		model: "fixture/joined",
	};
	writeFileSync(transient, JSON.stringify(row), { mode: 0o600 });
	await show(groups[0].scope);
	await terminal.waitForText("transient | joined", { timeout: 6000 });
	row.namespace = groups.at(-1).scope;
	row.name = "renamed";
	writeFileSync(transient, JSON.stringify(row));
	await until(
		() =>
			!JSON.parse(
				readFileSync(join(groups[0].directory, "snapshot.json"), "utf8"),
			).rows.some((r) => r.id === "transient"),
		"old scope cleared",
	);
	await terminal.getByScreenText(`Hub: ${groups[0].scope} (read-only)`).click();
	await terminal.type("r");
	await until(
		() => !terminal.screen().text().includes("transient | joined"),
		"old scoped frame cleared",
	);
	await show(groups.at(-1).scope);
	await terminal.waitForText("renamed | joined", { timeout: 6000 });
	rmSync(transient);
	await until(
		() =>
			!JSON.parse(
				readFileSync(join(groups.at(-1).directory, "snapshot.json"), "utf8"),
			).rows.some((r) => r.id === "transient"),
		"unregistered row removed",
	);
	await until(
		() => !terminal.screen().text().includes("renamed | joined"),
		"view unregister receipt",
	);
	await until(async () => {
		if (terminal.screen().text().includes("Pane #1")) return true;
		await terminal.press("F6");
		return false;
	}, "empty bootstrap tab");
	await terminal.press("F9");
	await show(groups[0].scope);
	assert(
		(await list()).some((p) => p.is_plugin && p.id === groups[0].view.id),
		"tab close replaced a surviving view",
	);
	if (groups[0].count === 10) {
		await terminal.resize({ columns: 80, rows: 12 });
		await terminal
			.getByScreenText(`Hub: ${groups[0].scope} (read-only)`)
			.click();
		await terminal.type("j".repeat(9));
		await terminal.waitForText(`>W ${groups[0].scope}-a10`);
		await terminal.resize({ columns: 140, rows: 40 });
		await terminal.waitForText(`>W ${groups[0].scope}-a10`);
	}
	if (process.argv.includes("--crash")) {
		assert.equal(
			proc(writerPid)?.start,
			writerStart,
			"collector identity changed before owned crash test",
		);
		process.kill(writerPid, "SIGKILL");
		await terminal.waitForText("STALE SNAPSHOT", { timeout: 9000 });
		assert(
			existsSync(join(output, ".owner")),
			"crash must retain uncertain owner lock",
		);
		const retry = await execute(indexer, writerArgs, {
			env,
			cwd: dir,
			timeout: 3000,
		}).then(
			() => false,
			() => true,
		);
		assert(retry, "unsafe crash takeover");
	} else {
		await action(
			"write",
			"--pane-id",
			`terminal_${writerPane.id}`,
			"113",
			"10",
		);
		await until(
			() => !existsSync(join(output, ".owner")),
			"clean collector release",
		);
		await terminal.waitForText("INDEXER STOPPED", { timeout: 5000 });
	}
	summary = {
		driver: "Termwright",
		nativeCollectors: 1,
		views: groups.length,
		agents: expected,
		collectorReadsPerScan: expected,
		viewSwitchMs: latencies,
		noHostPermissionRequests: true,
		fixedGeometry: true,
		reorderSafe: true,
		multipleClientsShareCollector: true,
		joinMoveRenameUnregister: true,
		selectionRetained: true,
		closeSafe: true,
		narrowPaging: groups[0].count === 10,
		stop: process.argv.includes("--crash")
			? "stale + takeover refused"
			: "stopped + owner released",
		cleanup: "passed",
	};
} catch (error) {
	if (terminal)
		process.stderr.write(terminal.screen().text().slice(0, 5000) + "\n");
	throw error;
} finally {
	try {
		if (started) {
			await run(["kill-session", session]);
			let gone = false;
			try {
				await list();
			} catch (e) {
				gone = typeof e.code === "number" && e.code !== 0;
			}
			assert(gone);
		}
	} finally {
		try {
			await second?.close();
			await terminal?.close();
			await until(
				() =>
					pids.every((pid) => {
						const p = proc(pid);
						return !p || ["Z", "X", "x"].includes(p.state);
					}),
				"fixture process cleanup",
				5000,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
process.stdout.write(JSON.stringify(summary) + "\n");

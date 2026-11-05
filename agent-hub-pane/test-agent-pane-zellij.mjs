#!/usr/bin/env node
/** Opt-in real-Zellij acceptance: disposable detached session, fixture processes only.
 * Never attaches to, configures, or sends input to an existing user session.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createNavigator } from "./pi-agents-pane-navigation.mjs";

const useTermwright = process.argv.includes("--termwright");
const load = process.argv.includes("--load") || useTermwright;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const session = `pi-hub-acceptance-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), "pi-hub-acceptance-"));
// Do not propagate Matrix/provider credentials or the caller's Zellij identity.
const env = {
	PATH: process.env.PATH ?? "/usr/bin:/bin",
	HOME: homedir(),
	TERM: "xterm-256color",
	SHELL: "/bin/sh",
	PI_AGENTS_PANE_STARTUP_DELAY: "0",
};
if (process.env.XDG_RUNTIME_DIR)
	env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
const registry = join(dir, "agents");
mkdirSync(registry);
const bin = join(dir, "bin");
mkdirSync(bin);
const realZellij = spawnSync("which", ["zellij"], { env, encoding: "utf8" }).stdout.trim();
assert(realZellij, "zellij executable required");
env.PATH = `${bin}:${env.PATH}`;
function run(args) {
	const result = spawnSync(realZellij, args, {
		env,
		encoding: "utf8",
		timeout: 5000,
		maxBuffer: 1024 * 1024,
	});
	if (result.error || result.status !== 0)
		throw Object.assign(new Error("isolated Zellij command failed"), {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		});
	return result.stdout;
}
const action = (...args) => run(["--session", session, "action", ...args]);
const panes = () => JSON.parse(action("list-panes", "--json", "--all"));
function visible(tabId) {
	try {
		return (
			action("are-floating-panes-visible", "--tab-id", String(tabId)).trim() ===
			"true"
		);
	} catch (error) {
		if (
			error.status === 2 &&
			error.stdout === "" &&
			error.stderr?.trim() === "false"
		)
			return false;
		if (error.status === 1 && error.stdout?.trim() === "false") return false;
		throw new Error("cannot determine fixture floating-layer visibility");
	}
}
async function until(check, label) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const result = check();
		if (result) return result;
		await delay(100);
	}
	throw new Error(`timed out: ${label}`);
}
function sendInput(paneId, text) {
	assert(Number.isSafeInteger(paneId) && paneId >= 0);
	action(
		"write",
		"--pane-id",
		`terminal_${paneId}`,
		...Array.from(Buffer.from(text), String),
	);
}

let summary, terminal, attachment, attachmentExit;
try {
	const version = run(["--version"]).trim();
	writeFileSync(join(dir, "config.kdl"), "session_serialization false\n");
	const helper = join(dir, "fixture-agent.mjs");
	writeFileSync(
		helper,
		`import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ownPaneIdentity} from ${JSON.stringify(pathToFileURL(join(root, "extensions/pi-agent-hub/registry/zellij-pane.mjs")).href)};
const name=process.argv[2];
const zellij=ownPaneIdentity({inside:process.env.ZELLIJ,sessionName:process.env.ZELLIJ_SESSION_NAME,paneId:process.env.ZELLIJ_PANE_ID,interactive:Boolean(process.stdin.isTTY&&process.stdout.isTTY)});
if(!zellij)throw new Error('fixture did not get its own terminal identity');
const record={id:name,name,pid:process.pid,cwd:process.cwd(),startedAt:Date.now(),status:'waiting',model:'fixture/model',zellij,...(name==='alpha'?{declared_name:'fixture'}:{namespace:'fixture'})};
const save=()=>writeFileSync(join(${JSON.stringify(registry)},name+'.json'),JSON.stringify({...record,heartbeat:Date.now()}));
save();setInterval(save,1000);
`,
	);
	// Fixture Pi only: proves argv/environment/pane integration without model calls.
	const fakePi = join(bin, "pi");
	writeFileSync(
		fakePi,
		`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nconst name=process.argv[process.argv.indexOf('--name')+1];\nwriteFileSync(${JSON.stringify(join(dir, "new-agent.json"))},JSON.stringify({name,argv:process.argv.slice(2),namespace:process.env.PI_PANOPTICON_NAMESPACE,spawnName:process.env.PI_PANOPTICON_SPAWN_NAME,parent:process.env.PI_PANOPTICON_PARENT_ID??null,matrixDisabled:process.env.PI_MATRIX_DISABLED,cwd:process.cwd(),pane:process.env.ZELLIJ_PANE_ID}));\nconst start=Date.now(); const save=()=>writeFileSync(${JSON.stringify(join(registry, "gamma.json"))},JSON.stringify({id:'gamma',name,pid:process.pid,cwd:process.cwd(),startedAt:start,heartbeat:Date.now(),status:'waiting',namespace:process.env.PI_PANOPTICON_NAMESPACE,zellij:{sessionName:process.env.ZELLIJ_SESSION_NAME,paneId:Number(process.env.ZELLIJ_PANE_ID)}}));save();setInterval(save,1000);\n`,
	);
	chmodSync(fakePi, 0o755);
	const node = JSON.stringify(process.execPath),
		cwd = JSON.stringify(dir);
	let loadTabs = "";
	const queryLog = join(dir, "pane-queries.jsonl");
	if (load) {
		// Log only action names from these fixture panes; never inherit user secrets.
		writeFileSync(queryLog, "");
		writeFileSync(join(bin, "zellij"), `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2), start=Date.now(); appendFileSync(${JSON.stringify(queryLog)}, JSON.stringify({action:args[3]})+'\\n');\nconst r=spawnSync(${JSON.stringify(realZellij)},args,{encoding:'utf8'});process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');let own;try {own=JSON.parse(r.stdout).find(p=>!p.is_plugin && String(p.id)===process.env.ZELLIJ_PANE_ID);}catch{} appendFileSync(${JSON.stringify(queryLog)},JSON.stringify({action:args[3],status:r.status,ms:Date.now()-start,pane:process.env.ZELLIJ_PANE_ID,focused:own?.is_focused,floating:own?.is_floating})+'\\n');process.exit(r.status??1);\n`);
		chmodSync(join(bin, "zellij"), 0o755);
		const noise = join(dir, "noise.mjs");
		writeFileSync(noise, `let n=0;const t=setInterval(()=>{if(!process.stdout.writableNeedDrain) process.stdout.write(('fixture output '+(++n)+' '+'.'.repeat(60)+'\\n').repeat(10));},100);setTimeout(()=>{clearInterval(t);},45000);\n`);
		// Eight Hub panes total; four bounded producers (~32 KiB/s), no model calls.
		for (let i = 0; i < 7; i++) loadTabs += `tab name="load-${i}" {
 pane name="load-hub-${i}" command=${node} cwd=${cwd} { args ${JSON.stringify(join(root, "agent-hub-pane/pi-agents-pane"))} "--scope" "fixture" "--registry" ${JSON.stringify(registry)} "--interval" "0.25"; }
 ${i < 2 ? `pane command=${node} cwd=${cwd} { args ${JSON.stringify(noise)}; }
 pane command=${node} cwd=${cwd} { args ${JSON.stringify(noise)}; }` : ""}
}\n`;
	}
	writeFileSync(
		join(dir, "layout.kdl"),
		`layout {
 tab name="fixture" focus=true {
  pane name="hub-view" command=${node} cwd=${cwd} { args ${JSON.stringify(join(root, "agent-hub-pane/pi-agents-pane"))} "--scope" "fixture" "--registry" ${JSON.stringify(registry)} "--interval" "0.25"; }
  floating_panes {
   pane name="alpha" command=${node} cwd=${cwd} { args ${JSON.stringify(helper)} "alpha"; width "60%"; height "60%"; x "30%"; y "20%"; }
   pane name="beta" command=${node} cwd=${cwd} { args ${JSON.stringify(helper)} "beta"; width "60%"; height "60%"; x "30%"; y "20%"; }
  }
 }
 ${loadTabs}
}
`,
	);
	run([
		"--config",
		join(dir, "config.kdl"),
		"--layout",
		join(dir, "layout.kdl"),
		"attach",
		"--create-background",
		session,
	]);
	const initial = await until(() => {
		const rows = panes().filter((p) => !p.is_plugin);
		return rows.length === (load ? 14 : 3) && rows.every((p) => !p.exited) ? rows : null;
	}, "fixture terminals");
	const view = initial.find((p) => p.title === "hub-view");
	const alpha = initial.find((p) => p.title === "alpha");
	const beta = initial.find((p) => p.title === "beta");
	assert(
		view &&
			alpha &&
			beta &&
			!view.is_floating &&
			alpha.is_floating &&
			beta.is_floating,
	);
	assert.equal(view.tab_id, alpha.tab_id);
	assert.equal(view.tab_id, beta.tab_id);
	// Focusing the tiled view hides the floating layer, without stopping its processes.
	action("focus-pane-id", `terminal_${view.id}`);
	await until(() => !visible(view.tab_id), "floating layer hidden");
	await until(
		() =>
			action("dump-screen", "--pane-id", `terminal_${view.id}`).includes(
				"l:lead q:quit",
			),
		"interactive view ready",
	);
	const before = action("dump-screen", "--pane-id", `terminal_${view.id}`);
	assert(
		before.includes("W alpha │ waiting") &&
			before.includes("W beta │ waiting"),
	);
	const betaRecord = JSON.parse(
		readFileSync(join(registry, "beta.json"), "utf8"),
	);
	assert.equal(betaRecord.zellij.paneId, beta.id);
	const navigator = createNavigator(
		{ sessionName: session, paneId: view.id },
		run,
	);
	assert.equal(navigator.inspect()?.own.is_focused, true);
	let performance;
	if (load) {
		if (useTermwright) {
			const { launchTerminal } = await import("@termwright/driver");
			terminal = await launchTerminal({
				command: [realZellij, "--config", join(dir, "config.kdl"), "attach", session],
				cwd: dir, columns: 120, rows: 40, envMode: "replace", env,
			});
			await terminal.waitForText("l:lead q:quit");
		} else {
			// Explicit stdlib PTY path, not a silent Termwright backend substitution.
			attachment = spawn("python3", ["-c", `
import os, pty, subprocess, select, sys, fcntl, termios, struct
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
try:
    while child.poll() is None:
        ready, _, _ = select.select([master, sys.stdin.buffer], [], [], 0.1)
        if master in ready:
            try: data = os.read(master, 65536)
            except OSError: break
            if not data: break
            sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
        if sys.stdin.buffer in ready:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data: break
            os.write(master, data)
finally:
    if child.poll() is None:
        child.terminate()
        try: child.wait(timeout=2)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
    os.close(master)
`, realZellij, "--config", join(dir, "config.kdl"), "attach", session], { env, cwd: dir, stdio: ["pipe", "pipe", "ignore"] });
			attachmentExit = new Promise((resolveExit, reject) => {
				attachment.once("exit", resolveExit);
				attachment.once("error", reject);
			});
			let received = false;
			attachment.stdout.on("data", () => { received = true; }); // drain, never retain raw terminal logs
			await until(() => received, "attached PTY output");
		}
		const ready = () => until(() => action("dump-screen", "--pane-id", `terminal_${view.id}`).includes("l:lead q:quit"), "attached Hub controls");
		await ready();
		const hubs = initial.filter((p) => !p.is_plugin && (p.title === "hub-view" || p.title.startsWith("load-hub-")));
		assert.equal(hubs.length, 8);
		for (const hub of hubs) await until(() => action("dump-screen", "--pane-id", `terminal_${hub.id}`).includes("l:lead q:quit"), "every Hub ready after concurrent startup");
		const producers = initial.filter((p) => !p.is_plugin && p.title.includes("noise.mjs"));
		assert.equal(producers.length, 4);
		const outputFrames = () => producers.map((p) => action("dump-screen", "--pane-id", `terminal_${p.id}`));
		const beforeOutput = outputFrames();
		const beforeIdle = readFileSync(queryLog, "utf8").length;
		await delay(1000); // four refresh intervals under continuous output load
		assert.equal(readFileSync(queryLog, "utf8").length, beforeIdle, "idle panes spawned Zellij queries");
		const afterOutput = outputFrames();
		assert(afterOutput.every((frame, i) => frame.includes("fixture output") && frame !== beforeOutput[i]), "all output producers must advance under load");
		const latencyMs = [];
		for (let i = 0; i < 4; i++) {
			action("focus-pane-id", `terminal_${view.id}`);
			await ready();
			const target = i % 2 === 0 ? beta : alpha;
			const started = Date.now();
			if (terminal) {
				await terminal.type(i % 2 === 0 ? "j" : "k");
				await terminal.press("Enter");
			} else attachment.stdin.write(i % 2 === 0 ? "j\r" : "k\r");
			await until(() => visible(view.tab_id) && panes().find((p) => p.id === target.id && !p.is_plugin)?.is_focused, "PTY focus receipt");
			latencyMs.push(Date.now() - started);
		}
		action("focus-pane-id", `terminal_${view.id}`);
		await ready();
		performance = { inputDriver: useTermwright ? "Termwright" : "Python stdlib PTY", hubPanes: 8, outputProducers: 4, configuredLinesPerSecond: 400, verifiedAdvancingProducers: 4, idleQueryCount: 0, idleWindowMs: 1000, focusLatencyMs: latencyMs };
	}
	// SGR left click on second agent row: header=1, alpha=2, beta=3.
	sendInput(view.id, "\x1b[<0;8;3M");
	await until(
		() =>
			visible(view.tab_id) &&
			panes().find((p) => p.id === beta.id && !p.is_plugin)?.is_focused,
		"mouse reveals beta",
	);
	assert.equal(navigator.inspect()?.own.is_focused, false);
	action("focus-pane-id", `terminal_${view.id}`);
	await until(() => !visible(view.tab_id), "return to view hides floats");
	await delay(350); // view's bounded refresh resumes before keyboard input
	sendInput(view.id, "\x1b[A\r");
	await until(
		() =>
			visible(view.tab_id) &&
			panes().find((p) => p.id === alpha.id && !p.is_plugin)?.is_focused,
		"keyboard reveals alpha",
	);
	assert.equal(navigator.inspect()?.own.is_focused, false);
	assert(
		panes()
			.filter((p) => p.is_floating)
			.every((p) => !p.exited),
	);
	// Close only beta while the floating layer is hidden. Confirmation is a
	// second, distinct input; verify the tiled Hub and alpha survive unchanged.
	action("focus-pane-id", `terminal_${view.id}`);
	await until(() => !visible(view.tab_id), "hide floaters before close");
	await delay(350);
	sendInput(view.id, "j");
	await delay(150);
	sendInput(view.id, "c");
	await until(
		() =>
			action("dump-screen", "--pane-id", `terminal_${view.id}`).includes(
				`Close #${beta.id} [W] Y/n`,
			),
		"close confirmation",
	);
	sendInput(view.id, "\r");
	await until(
		() => !panes().some((p) => !p.is_plugin && p.id === beta.id),
		"hidden beta pane closed",
	);
	assert(panes().some((p) => !p.is_plugin && p.id === view.id && !p.exited));
	assert(panes().some((p) => !p.is_plugin && p.id === alpha.id && !p.exited));
	assert.equal(visible(view.tab_id), false);
	await until(() => action("dump-screen", "--pane-id", `terminal_${view.id}`).includes("Pane closed: beta"), "close UI settled after verification");
	// Start a fixture agent by typing a name; Pi is a no-model stub in this session.
	sendInput(view.id, "n");
	await until(
		() =>
			action("dump-screen", "--pane-id", `terminal_${view.id}`).includes(
				"Name:",
			),
		"new-agent form",
	);
	sendInput(view.id, "gamma");
	await until(
		() =>
			action("dump-screen", "--pane-id", `terminal_${view.id}`).includes(
				"Name: gamma",
			),
		"typed agent name",
	);
	sendInput(view.id, "\r");
	await until(
		() =>
			action("dump-screen", "--pane-id", `terminal_${view.id}`).includes(
				"Default model? Y/n gamma",
			),
		"create confirmation",
	);
	await delay(350);
	sendInput(view.id, "\r");
	const created = await until(() => {
		try {
			return JSON.parse(readFileSync(join(dir, "new-agent.json"), "utf8"));
		} catch {
			return null;
		}
	}, "fixture agent started");
	assert.equal(created.name, "gamma");
	assert.deepEqual(created.argv, ["--name", "gamma"]);
	assert.equal(created.namespace, "fixture");
	assert.equal(created.spawnName, "gamma");
	assert.equal(created.parent, null);
	assert.equal(created.matrixDisabled, "1");
	assert.equal(created.cwd, dir);
	const gamma = await until(
		() => panes().find((p) => !p.is_plugin && p.title === "gamma"),
		"new floating pane",
	);
	assert.equal(gamma.tab_id, view.tab_id);
	assert.equal(gamma.is_floating, true);
	assert.equal(String(gamma.id), created.pane);
	action("focus-pane-id", `terminal_${view.id}`);
	await until(
		() =>
			action("dump-screen", "--pane-id", `terminal_${view.id}`).includes(
				"W gamma │ waiting",
			),
		"new agent visible in Hub",
	);
	summary = {
		...(performance ? { performance } : {}),
		create:
			"named fixture Pi started floating in same tab, without model override",
		close: "hidden beta closed after confirmation; hub and alpha survive",
		version,
		mouse: "hidden beta revealed and focused",
		keyboard: "hidden alpha revealed and focused",
		returnToView: "floating layer hidden; agents still running",
		identity: "captured by fixture agents in their own terminals",
		cleanup: "passed",
	};
} catch (error) {
	if (load) {
		const rows = panes();
		const view = rows.find((p) => p.title === "hub-view");
		process.stderr.write(`${JSON.stringify({ queries: readFileSync(join(dir, "pane-queries.jsonl"), "utf8").split("\n").slice(-14), fixtureScreen: view ? action("dump-screen", "--pane-id", `terminal_${view.id}`).slice(0, 4096) : null, panes: rows.map((p) => ({ id: p.id, title: p.title, focused: p.is_focused, floating: p.is_floating })) })}\n`);
	}
	throw error;
} finally {
	// Unique generated session only; no kill-all, no existing-session operations.
	try {
		run(["kill-session", session]);
		const gone = spawnSync(realZellij, ["--session", session, "action", "list-panes", "--json"], { env, timeout: 5000, stdio: "ignore" });
		assert(gone.status !== null && gone.status !== 0, "scratch session still accessible after cleanup");
	} finally {
		try {
			await terminal?.close();
			attachment?.stdin.end();
			if (attachmentExit) await attachmentExit;
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
process.stdout.write(`${JSON.stringify(summary)}\n`);

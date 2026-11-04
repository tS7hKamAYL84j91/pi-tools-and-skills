#!/usr/bin/env node
/** Opt-in real-Zellij acceptance: disposable detached session, fixture processes only.
 * Never attaches to, configures, or sends input to an existing user session.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const session = `pi-hub-acceptance-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), "pi-hub-acceptance-"));
// Do not propagate Matrix/provider credentials or the caller's Zellij identity.
const env = {
	PATH: process.env.PATH ?? "/usr/bin:/bin",
	HOME: homedir(),
	TERM: "xterm-256color",
	SHELL: "/bin/sh",
};
if (process.env.XDG_RUNTIME_DIR)
	env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
const registry = join(dir, "agents");
mkdirSync(registry);
const bin = join(dir, "bin");
mkdirSync(bin);
env.PATH = `${bin}:${env.PATH}`;
function run(args) {
	const result = spawnSync("zellij", args, {
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

let summary;
try {
	const version = run(["--version"]).trim();
	writeFileSync(join(dir, "config.kdl"), "session_serialization false\n");
	const helper = join(dir, "fixture-agent.mjs");
	writeFileSync(
		helper,
		`import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ownPaneIdentity} from ${JSON.stringify(pathToFileURL(join(root, "lib/zellij-pane.mjs")).href)};
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
	writeFileSync(
		join(dir, "layout.kdl"),
		`layout {
 tab name="fixture" {
  pane name="hub-view" command=${node} cwd=${cwd} { args ${JSON.stringify(join(root, "scripts/pi-agents-pane"))} "--scope" "fixture" "--registry" ${JSON.stringify(registry)} "--interval" "0.25"; }
  floating_panes {
   pane name="alpha" command=${node} cwd=${cwd} { args ${JSON.stringify(helper)} "alpha"; width "60%"; height "60%"; x "30%"; y "20%"; }
   pane name="beta" command=${node} cwd=${cwd} { args ${JSON.stringify(helper)} "beta"; width "60%"; height "60%"; x "30%"; y "20%"; }
  }
 }
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
		return rows.length === 3 && rows.every((p) => !p.exited) ? rows : null;
	}, "three fixture terminals");
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
		before.includes("W - alpha - waiting") &&
			before.includes("W - beta - waiting"),
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
				"W - gamma - waiting",
			),
		"new agent visible in Hub",
	);
	summary = {
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
} finally {
	// Unique generated session only; no kill-all, no existing-session operations.
	try {
		run(["kill-session", session]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
process.stdout.write(`${JSON.stringify(summary)}\n`);

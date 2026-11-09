#!/usr/bin/env node
// Opt-in native command acceptance. Private session, fake pi, no model calls.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { launchTerminal } from "@termwright/driver";
const here = dirname(fileURLToPath(import.meta.url)),
	wasm = resolve(here, "target/wasm32-wasip1/release/pi-shared-hub.wasm"),
	indexer = resolve(here, "target/release/pi-hub-index");
const dir = mkdtempSync(join(tmpdir(), "hva-")),
	session = `hva-${randomUUID().slice(0, 8)}`,
	registry = join(dir, "agents"),
	output = join(dir, "views");
mkdirSync(registry, { mode: 0o700 });
mkdirSync(join(dir, "bin"), { mode: 0o700 });
const env = {
	PATH: `${join(dir, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
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
for (const key of [
	"MATRIX_ACCESS_TOKEN",
	"MATRIX_BOT_TOKEN",
	"MATRIX_BOT_PASSWORD",
	"MATRIX_RECOVERY_PASSPHRASE",
	"PI_PANOPTICON_PARENT_ID",
	"PI_CODING_AGENT_SESSION_DIR",
])
	env[key] = "fixture-no-authority";
const zellij = spawnSync("which", ["zellij"], {
		env,
		encoding: "utf8",
	}).stdout.trim(),
	execute = promisify(execFile);
const run = async (args) =>
	(
		await execute(zellij, args, {
			env,
			cwd: dir,
			encoding: "utf8",
			timeout: 6000,
			maxBuffer: 1024 * 1024,
		})
	).stdout;
const action = (...args) => run(["--session", session, "action", ...args]);
const list = async () =>
	JSON.parse(await action("list-panes", "--json", "--all"));
async function until(check, label, ms = 12000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await check()) return;
		await delay(100);
	}
	throw Error(`timeout: ${label}`);
}
function proc(pid) {
	try {
		const fields = readFileSync(`/proc/${pid}/stat`, "utf8")
			.split(")")
			.at(-1)
			.trim()
			.split(/\s+/);
		return { state: fields[0], start: fields[19] };
	} catch (e) {
		if (e.code === "ENOENT") return null;
		throw e;
	}
}
const denied = process.argv.includes("--deny");
const focus = process.argv.includes("--focus");
const rejectFocus = process.argv.includes("--reject-focus");
const pids = [];
function remember(pid) {
	pids.push({ pid, start: proc(pid)?.start });
}
let terminal,
	second,
	started = false,
	result;
try {
	assert(existsSync(wasm) && existsSync(indexer));
	if (focus) {
		writeFileSync(
			join(dir, "bin/zellij"),
			`#!/usr/bin/python3\nimport os,sys,time\nfrom pathlib import Path\nroot=Path(${JSON.stringify(dir)})\nif (root/'focus-delay').exists() and 'list-panes' in sys.argv:\n (root/'query-started').touch();time.sleep(.4)\nos.execv(${JSON.stringify(zellij)},[${JSON.stringify(zellij)}]+sys.argv[1:])\n`,
		);
		chmodSync(join(dir, "bin/zellij"), 0o700);
	}
	writeFileSync(
		join(dir, "agent.py"),
		`import json,os,sys,time,signal
from pathlib import Path
root=Path(${JSON.stringify(dir)})
name=sys.argv[1];lead=(name=='lead');record=root/'agents'/(name+'.json')
row=dict(id=name,name=name,pid=os.getpid(),startedAt=int(time.time()*1000),heartbeat=int(time.time()*1000),cwd=str(root),status='waiting',model='fixture/model',zellij=dict(sessionName=os.environ['ZELLIJ_SESSION_NAME'],paneId=int(os.environ['ZELLIJ_PANE_ID'])))
row['declared_name' if lead else 'namespace']='lead'
def stop(*args):
 signal.signal(signal.SIGHUP,signal.SIG_IGN);signal.signal(signal.SIGTERM,signal.SIG_IGN)
 raise SystemExit(0)
signal.signal(signal.SIGHUP,stop);signal.signal(signal.SIGTERM,stop)
try:
 for tick in range(180):
  row['heartbeat']=int(time.time()*1000);row['status']=(root/'born-status').read_text().strip() if name=='born' and (root/'born-status').exists() else 'waiting';temp=record.with_suffix('.tmp');temp.write_text(json.dumps(row));temp.chmod(0o600);temp.replace(record)
  print('fixture '+name,flush=True);time.sleep(.5)
finally:
 record.unlink(missing_ok=True)
`,
	);
	writeFileSync(
		join(dir, "bin/pi"),
		`#!/usr/bin/python3
import json,os,sys
from pathlib import Path
root=Path(${JSON.stringify(dir)});keys=['MATRIX_ACCESS_TOKEN','MATRIX_BOT_TOKEN','MATRIX_BOT_PASSWORD','MATRIX_RECOVERY_PASSPHRASE','PI_PANOPTICON_PARENT_ID','PI_CODING_AGENT_SESSION_DIR']
name=os.environ.get('PI_PANOPTICON_SPAWN_NAME','')
(root/'child-observed.json').write_text(json.dumps(dict(name=name,namespace=os.environ.get('PI_PANOPTICON_NAMESPACE'),disabled=os.environ.get('PI_MATRIX_DISABLED'),forbiddenPresent=[key for key in keys if key in os.environ],modelOverride='--model' in sys.argv)))
os.execv('/usr/bin/python3',['python3',str(root/'agent.py'),name])
`,
	);
	chmodSync(join(dir, "bin/pi"), 0o700);
	const args = [
		"--registry",
		registry,
		"--output",
		output,
		"--scope",
		"lead",
		...(denied ? [] : ["--actions", "--session", session]),
	];
	const prepared = JSON.parse(
		(
			await execute(indexer, [...args, "--prepare"], {
				env,
				cwd: dir,
				timeout: 5000,
			})
		).stdout,
	);
	const scopeDir = prepared.scopes[0].directory;
	writeFileSync(
		join(dir, "config.kdl"),
		`session_serialization false
mirror_session false
keybinds {
 normal {
  bind "F6" { GoToPreviousTab; }
  bind "F7" { GoToNextTab; }
  bind "F8" { MoveTab "Left"; }
 }
}
show_release_notes false
show_startup_tips false
`,
	);
	writeFileSync(
		join(dir, "collector.kdl"),
		`layout {\n tab name="data" {\n  pane name="indexer" command=${JSON.stringify(indexer)} { args ${args.map((a) => JSON.stringify(a)).join(" ")}; }\n }\n}\n`,
	);
	writeFileSync(
		join(dir, "view.kdl"),
		`layout {\n tab name="lead" {\n  pane split_direction="vertical" {\n   pane name="lead" command="python3" cwd=${JSON.stringify(dir)} { args ${JSON.stringify(join(dir, "agent.py"))} "lead"; }\n   pane name="view" size=40 {\n    plugin location=${JSON.stringify(`file:${wasm}`)} { scope "lead"; actions "true"; ${focus || rejectFocus ? 'focus "true";' : ""} }\n   }\n  }\n }\n}\n`,
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
	await action("new-tab", "--layout", join(dir, "collector.kdl"));
	await action("new-tab", "--layout", join(dir, "view.kdl"), "--cwd", scopeDir);
	if (focus || rejectFocus) {
		await terminal.waitForText("Allow?", { timeout: 10000 });
		await terminal.getByScreenText("Allow?").click();
		await terminal.type(rejectFocus ? "n" : "y");
	}
	await terminal.waitForText(denied ? "j/k select" : "n new c close l lead", {
		timeout: 10000,
	});
	await terminal.waitForText("waiting | model");
	remember(JSON.parse(readFileSync(join(registry, "lead.json"), "utf8")).pid);
	remember(
		Number(/pid=(\d+)/.exec(readFileSync(join(output, ".owner"), "utf8"))[1]),
	);
	assert(!terminal.screen().text().includes("Allow?"));
	if (denied) {
		await terminal.getByScreenText("Hub: lead").click();
		await terminal.type("n");
		await terminal.waitForText("Actions disabled");
		await terminal.type("cy");
		await delay(2300);
		assert(!existsSync(join(registry, "born.json")));
		assert(!existsSync(join(scopeDir, "inbox")));
		assert(existsSync(join(registry, "lead.json")));
		const view = (await list()).find((p) => p.is_plugin && p.title === "view");
		await terminal.type("q");
		await until(
			async () => !(await list()).some((p) => p.is_plugin && p.id === view.id),
			"permissionless local quit",
		);
		result = {
			permissionlessQuit: true,
			nativeCommandCapability: false,
			viewOptIn: true,
			mutations: 0,
			readOnlyFallback: true,
			fixtureCleanup: "passed",
		};
	} else {
		await terminal.getByScreenText("Hub: lead").click();
		if (focus) {
			await terminal.press("Enter");
			await terminal.waitForText("Pending native validation");
			await terminal.waitForText("Focused: client-local receipt");
			const view = (await list()).find(
				(p) => p.is_plugin && p.title === "view",
			);
			await action("focus-pane-id", `plugin_${view.id}`);
			await terminal.getByScreenText("Hub: lead").click();
		}
		await terminal.type("n");
		await terminal.waitForText("Name:");
		await terminal.type("born");
		await terminal.press("Enter");
		await terminal.waitForText("Default model? Y/n born", { timeout: 12000 });
		assert(
			!existsSync(join(registry, "born.json")),
			"created before confirmation",
		);
		await terminal.type("y");
		await until(
			() => existsSync(join(registry, "born.json")),
			"native New registration",
			15000,
		);
		const born = JSON.parse(readFileSync(join(registry, "born.json"), "utf8"));
		remember(born.pid);
		const child = JSON.parse(
			readFileSync(join(dir, "child-observed.json"), "utf8"),
		);
		assert.deepEqual(child, {
			name: "born",
			namespace: "lead",
			disabled: "1",
			forbiddenPresent: [],
			modelOverride: false,
		});
		// The new floating agent may own focus. Return to the fixed view through the
		// native CLI only as fixture input setup, never as action-delivery evidence.
		const view = (await list()).find((p) => p.is_plugin && p.title === "view");
		assert(view);
		await action("focus-pane-id", `plugin_${view.id}`);
		await terminal.waitForText("Active: live registration verified", {
			timeout: 12000,
		});
		await terminal.waitForText("born");
		await terminal.getByScreenText("Hub: lead").click();
		if (rejectFocus) {
			await terminal.press("Enter");
			await terminal.waitForText("Focus disabled");
			assert(
				(await list()).find((p) => p.is_plugin && p.id === view.id)?.is_focused,
			);
		}
		if (focus) {
			// Focus the tiled lead: SDK must hide floating panes and retain processes.
			await terminal.press("Enter");
			await terminal.waitForText("Pending native validation");
			await terminal.waitForText("Focused: client-local receipt");
			await until(
				async () =>
					(await list()).some(
						(p) =>
							!p.is_plugin &&
							p.id ===
								JSON.parse(readFileSync(join(registry, "lead.json"), "utf8"))
									.zellij.paneId &&
							p.is_focused,
					),
				"client-local tiled focus",
			);
			await action("focus-pane-id", `plugin_${view.id}`);
			await terminal.getByScreenText("Hub: lead").click();
			await terminal.type("j");
			await terminal.waitForText(">W born");
			await terminal.press("Enter");
			await terminal.waitForText("Pending native validation");
			await terminal.waitForText("Focused: client-local receipt");
			await until(
				async () =>
					(await list()).some(
						(p) => !p.is_plugin && p.id === born.zellij.paneId && p.is_focused,
					),
				"client-local floating focus",
			);
			await action("focus-pane-id", `plugin_${view.id}`);
			await terminal.waitForText("Focused: client-local receipt");
			await terminal.getByScreenText("Hub: lead").click();
			// Another client becomes last-active while native validation waits.
			// Client-local SDK delivery must not retarget it or change its tab.
			second = await launchTerminal({
				command: [
					zellij,
					"--config",
					join(dir, "config.kdl"),
					"attach",
					session,
				],
				cwd: dir,
				columns: 140,
				rows: 40,
				envMode: "replace",
				env,
			});
			await second.waitForText("Hub: lead");
			await second.press("F6");
			await second.waitForText("q Enter stops");
			writeFileSync(join(dir, "focus-delay"), "");
			await terminal.press("Enter");
			await until(
				() => existsSync(join(dir, "query-started")),
				"cancellable native focus await",
			);
			await terminal.type("k");
			await terminal.waitForText(">W lead");
			await delay(900);
			assert(
				(await list()).some(
					(p) => p.is_plugin && p.id === view.id && p.is_focused,
				),
				"cancelled focus was dispatched",
			);
			rmSync(join(dir, "query-started"));
			await terminal.type("j");
			await terminal.waitForText(">W born");
			await terminal.getByScreenText(">W born").click();
			await until(
				() => existsSync(join(dir, "query-started")),
				"native focus metadata await",
			);
			await second.type(" ");
			await terminal.waitForText("Focused: client-local receipt", {
				timeout: 10000,
			});
			assert(
				second.screen().text().includes("q Enter stops"),
				"focus navigated the other client",
			);
			assert(!second.screen().text().includes("Hub: lead"));
			rmSync(join(dir, "focus-delay"));
			await terminal.type(" "); // Fixture setup: make this client CLI-active again.
			await action("focus-pane-id", `plugin_${view.id}`);
			await terminal.getByScreenText("Hub: lead").click();
			await second.press("Control+o");
			await delay(100);
			await second.press("d");
			await second.waitForExit({ timeout: 5000 });
			await second.close();
			second = undefined;
			// Stable tab ID no longer equals its position after reordering.
			await terminal.press("F8");
			await terminal.type("k");
			await terminal.waitForText(">W lead");
			await terminal.press("Enter");
			await terminal.waitForText("Pending native validation");
			await terminal.waitForText("Focused: client-local receipt");
			await action("focus-pane-id", `plugin_${view.id}`);
			await terminal.getByScreenText("Hub: lead").click();
			await terminal.type("j");
			await terminal.waitForText(">W born");
		} else {
			await terminal.getByScreenText("W born").click();
			await terminal.waitForText(">W born");
		}
		await terminal.type("l");
		await terminal.waitForText("Hub: lead lead: born");
		await terminal.type("c");
		await terminal.waitForText("Close #", { timeout: 12000 });
		assert(
			existsSync(join(registry, "born.json")),
			"closed before confirmation",
		);
		writeFileSync(join(dir, "born-status"), "running");
		await until(
			() =>
				JSON.parse(readFileSync(join(registry, "born.json"), "utf8")).status ===
				"running",
			"changed canonical state",
		);
		await terminal.type("y");
		await terminal.waitForText("identity or state changed", { timeout: 10000 });
		assert(
			existsSync(join(registry, "born.json")),
			"stale approval closed agent",
		);
		writeFileSync(join(dir, "born-status"), "waiting");
		await until(
			() =>
				JSON.parse(readFileSync(join(registry, "born.json"), "utf8")).status ===
				"waiting",
			"restored fixture state",
		);
		await terminal.waitForText(">W born", { timeout: 6000 });
		await terminal.type("c");
		await terminal.waitForText("Close #", { timeout: 12000 });
		await terminal.type("y");
		await until(
			() => !existsSync(join(registry, "born.json")),
			"native Close unregister",
			12000,
		);
		await terminal.waitForText("Removed: pane absent", { timeout: 12000 });
		assert(
			!(await list()).some((p) => !p.is_plugin && p.id === born.zellij.paneId),
		);
		result = {
			nativeRust: true,
			wasmUi: true,
			newConfirmed: true,
			liveRegistrationVerified: true,
			environmentScrubbed: true,
			modelDefaultsUnchanged: true,
			focusOptIn: focus,
			clientLocalKeyboardAndMouseFocus: focus,
			otherClientUnaffected: focus,
			focusAfterTabReorder: focus,
			pendingFocusCancelled: focus,
			focusDeniedFallback: rejectFocus,
			mouseSelection: !focus,
			localLead: true,
			closeConfirmed: true,
			staleApprovalRefused: true,
			paneAndUnregisterVerified: true,
			historyDeleted: false,
			fixtureCleanup: "passed",
		};
	}
} catch (error) {
	if (terminal)
		process.stderr.write(terminal.screen().text().slice(0, 5000) + "\n");
	throw error;
} finally {
	try {
		if (started) await run(["kill-session", session]);
	} finally {
		try {
			await second?.close();
			await terminal?.close();
			await until(
				() =>
					pids.every(({ pid, start }) => {
						const value = proc(pid);
						return (
							!value ||
							value.start !== start ||
							["Z", "X", "x"].includes(value.state)
						);
					}),
				"fixture process cleanup",
				5000,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
console.log(JSON.stringify(result));

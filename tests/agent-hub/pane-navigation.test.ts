import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { ownPaneIdentity, paneIdentity } from "../../extensions/pi-agent-hub/registry/zellij-pane.mjs";

const url = pathToFileURL(
	resolve("scripts/pi-agents-pane-navigation.mjs"),
).href;
function probe(code: string): unknown {
	return JSON.parse(
		execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import {createNavigator, inputParser} from ${JSON.stringify(url)};
const calls = [];
const panes = [
 {id: 99, tab_id: 1, is_plugin: false, is_focused: true, pane_cwd: '/view'},
 {id: 2, tab_id: 1, is_plugin: false, is_focused: false, pane_cwd: '/work'},
 {id: 3, tab_id: 2, is_plugin: false, is_focused: false, pane_cwd: '/work'}
];
const row = {id:'agent', state:'live', status:'waiting', heartbeat: 1000, navigation:{cwd:'/work', zellij:{sessionName:'session', paneId:2}}};
const identity = {sessionName:'session',paneId:99};
const runner = args => {calls.push(args); return JSON.stringify(panes);};
${code}`,
			],
			{ encoding: "utf8" },
		),
	);
}

it("captures only valid terminal identity for an interactive non-child agent", () => {
	const env = {
		inside: "0",
		sessionName: "session",
		paneId: "terminal_2",
		interactive: true,
	};
	expect(ownPaneIdentity(env)).toEqual({ sessionName: "session", paneId: 2 });
	expect(ownPaneIdentity({ ...env, interactive: false })).toBeUndefined();
	expect(ownPaneIdentity({ ...env, parentId: "parent" })).toBeUndefined();
	expect(ownPaneIdentity({ ...env, inside: undefined })).toBeUndefined();
});
it.each([
	"plugin_2",
	"../../x",
	"2; rm -rf",
	"2\n",
	"-1",
	"9007199254740992",
])("rejects invalid terminal identity %j", (id) => {
	expect(paneIdentity("session", id)).toBeUndefined();
});
it("same-tab exact identity focuses only terminal_2 with fixed argv", () => {
	expect(
		probe(
			`const result = createNavigator(identity, runner).focus(row, [row], 1001); process.stdout.write(JSON.stringify({result,calls}));`,
		),
	).toEqual({
		result: null,
		calls: [
			["--session", "session", "action", "list-panes", "--json", "--all"],
			["--session", "session", "action", "focus-pane-id", "terminal_2"],
		],
	});
});
it.each([
	["cross-tab", "row.navigation.zellij.paneId = 3;"],
	["cross-session", "row.navigation.zellij.sessionName = 'other';"],
	["plugin", "panes[1].is_plugin = true;"],
	["no pane", "panes.splice(1,1);"],
	["duplicate id across tabs", "panes[2].id = 2;"],
	["own pane", "row.navigation.zellij.paneId = 99;"],
	["headless child", "row.navigation.parentId = 'parent';"],
	["dead process", "row.state = 'stale';"],
	["unknown process", "row.state = 'unknown';"],
	["terminated", "row.status = 'terminated';"],
	["old heartbeat", "row.heartbeat = -30000;"],
	["future heartbeat", "row.heartbeat = 2000;"],
	["changed cwd", "panes[1].pane_cwd = '/different';"],
	["missing metadata", "delete row.navigation.zellij;"],
	["view unfocused", "panes[0].is_focused = false;"],
	["own pane ambiguous", "panes.push({...panes[0], tab_id:2});"],
])("refuses %s without a focus invocation", (_label, setup) => {
	const result = probe(
		`${setup} const result=createNavigator(identity, runner).focus(row,[row],1001); process.stdout.write(JSON.stringify({result,focusCalls:calls.filter(a=>a.includes('focus-pane-id'))}));`,
	) as { result: string; focusCalls: unknown[] };
	expect(result.result).toBeTruthy();
	expect(result.focusCalls).toEqual([]);
});
it("reveals a hidden floating target and treats the tiled view as unfocused afterwards", () => {
	const value = probe(`
		panes[0].is_floating=false; panes[1].is_floating=true; panes[1].is_focused=true;
		let visible=false;
		const run=args=>{
			calls.push(args);
			if(args.includes('are-floating-panes-visible')) {
				if(!visible)throw Object.assign(new Error(),{status:2,stdout:'',stderr:'false\\n'});
				return 'true\\n';
			}
			if(args.includes('focus-pane-id')) {visible=true;return '';}
			return JSON.stringify(panes);
		};
		const nav=createNavigator(identity,run);
		const before=nav.inspect().own.is_focused;
		const result=nav.focus(row,[row],1001);
		const after=nav.inspect().own.is_focused;
		const again=nav.focus(row,[row],1001);
		process.stdout.write(JSON.stringify({before,result,after,again,focus:calls.filter(a=>a.includes('focus-pane-id'))}));
	`);
	expect(value).toEqual({
		before: true,
		result: null,
		after: false,
		again: "navigation unavailable",
		focus: [["--session", "session", "action", "focus-pane-id", "terminal_2"]],
	});
});

it.each([
	"error",
	"invalid-response",
])("disables navigation when floating-layer visibility is %s", (mode) => {
	const value = probe(`panes[1].is_floating=true;
		const nav=createNavigator(identity,args=>{calls.push(args); if(args.includes('are-floating-panes-visible')) {${mode === "error" ? "throw Object.assign(new Error('private'), {status:2,stdout:'',stderr:'private'});" : "return 'unknown';"}}return JSON.stringify(panes);});
		process.stdout.write(JSON.stringify({result:nav.focus(row,[row],1001),focus:calls.filter(a=>a.includes('focus-pane-id'))}));`);
	expect(value).toEqual({ result: "navigation unavailable", focus: [] });
});

it.each([
	"exited",
	"is_suppressed",
])("refuses %s targets even with a fresh record", (flag) => {
	expect(
		probe(
			`panes[1][${JSON.stringify(flag)}]=true; const result=createNavigator(identity,runner).focus(row,[row],1001);process.stdout.write(JSON.stringify({result,focus:calls.filter(a=>a.includes('focus-pane-id'))}));`,
		),
	).toEqual({ result: "pane is unavailable", focus: [] });
});

it("refuses duplicate self-reported pane claims", () => {
	expect(
		probe(
			`const result=createNavigator(identity, runner).focus(row,[row,{...row,id:'other'}],1001); process.stdout.write(JSON.stringify({result,calls:calls.length}));`,
		),
	).toEqual({ result: "ambiguous agent pane", calls: 1 });
});
it("missing env makes no invocation; unavailable executable/listing fails quietly", () => {
	expect(
		probe(
			`const missing=createNavigator(undefined, runner).inspect(); const failed=createNavigator(identity,()=>{throw new Error('private stderr');}).inspect(); process.stdout.write(JSON.stringify({missing,failed,calls}));`,
		),
	).toEqual({ missing: null, failed: null, calls: [] });
});
it("focus failure reports a bounded notice, never raw stderr", () => {
	expect(
		probe(
			`const nav=createNavigator(identity,args=>{if(args.includes('focus-pane-id'))throw new Error('private stderr');return runner(args);});process.stdout.write(JSON.stringify(nav.focus(row,[row],1001)));`,
		),
	).toBe("pane gone or focus failed");
});
it("accepts normalized terminal metadata without changing the target", () => {
	expect(
		probe(
			`row.navigation.zellij.paneId='terminal_2'; const result=createNavigator(identity, runner).focus(row,[row],1001);process.stdout.write(JSON.stringify({result,target:calls.at(-1).at(-1)}));`,
		),
	).toEqual({ result: null, target: "terminal_2" });
});

it.each(
	[
		["\\x1b[200~", "qj\\r" + "x".repeat(10000), "\\x1b[201~"],
		["\\x1b[<", "a".repeat(10000) + "qj\\r"],
		["\\x1b]52;", "qj\\r", "\\x07"],
		["\\x1bP", "qj\\r", "\\x1b\\\\"],
	].map((chunks) => ({ chunks })),
)("does not turn pasted or malformed terminal payloads into actions", ({
	chunks,
}) => {
	// Interpret escape spellings in the child script, keeping fixtures easy to inspect.
	const calls = chunks
		.map((chunk) => `parse('${chunk.replaceAll("'", "\\'")}')`)
		.join(",");
	expect(
		probe(
			`const parse=inputParser(); const events=[${calls}].flat(); process.stdout.write(JSON.stringify(events));`,
		),
	).toEqual([]);
});

it("incrementally parses arrows, mouse press/release and keyboard controls", () => {
	expect(
		probe(
			`const parse=inputParser();const events=[...parse('\\x1b['),...parse('Bj'),...parse('\\x1b[<0;5;'),...parse('3M\\x1b[<0;5;3m'),...parse('k\\r'),...parse('q')];process.stdout.write(JSON.stringify(events));`,
		),
	).toEqual([
		{ type: "move", delta: 1 },
		{ type: "move", delta: 1 },
		{ type: "click", x: 5, y: 3 },
		{ type: "move", delta: -1 },
		{ type: "focus" },
		{ type: "quit" },
	]);
});

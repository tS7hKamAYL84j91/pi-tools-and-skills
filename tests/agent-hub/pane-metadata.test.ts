import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { paneChildEnv } from "./helpers.js";

const url = pathToFileURL(resolve("agent-hub-pane/pi-agents-pane-navigation.mjs")).href;
const header = "TAB_ID  TAB_POS  TAB_NAME  PANE_ID  TYPE  TITLE  FOCUSED  FLOATING  EXITED";
const tabs = [{ tab_id: 1, position: 0, name: "tab  with spaces", selectable_tiled_panes_count: 1, selectable_floating_panes_count: 1, are_floating_panes_visible: false }];
const lines = ["1  0  tab  with spaces  terminal_99  terminal  Hub  true  false  false", "1  0  tab  with spaces  terminal_2  terminal  worker  title  false  true  false"];
function probe(code: string): unknown {
	return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
import {parsePaneTable, createNavigator} from ${JSON.stringify(url)};
const tabs=${JSON.stringify(tabs)}, lines=${JSON.stringify(lines)}, header=${JSON.stringify(header)};
const table=header+'\\n'+lines.join('\\n')+'\\n';
${code}
`], { encoding: "utf8", env: paneChildEnv() }));
}

it("anchors unescaped tab names to structured metadata and validates per-layer counts", () => {
	expect(probe("process.stdout.write(JSON.stringify(parsePaneTable(table,tabs)));" )).toEqual([
		{ id: 99, is_plugin: false, tab_id: 1, is_focused: true, is_floating: false, exited: false },
		{ id: 2, is_plugin: false, tab_id: 1, is_focused: false, is_floating: true, exited: false },
	]);
});

it.each([
	"header='bad header'",
	"lines[0]=lines[0].replace('1  0','1  9')",
	"lines[0]=lines[0].replace('tab  with spaces','different tab')",
	"lines[1]=lines[1].replace('terminal_2','terminal_99')",
	"lines[1]=lines[1].replace('terminal_2','plugin_2')",
	"lines[1]=lines[1].replace('worker  title','x  terminal_777  terminal  fake')",
	"lines[1]=lines[1].replace('worker  title','x  true  false  false\\n1  0  tab  with spaces  terminal_777  terminal  fake')",
	"lines.push('1  0  tab  with spaces  terminal_777  terminal  fake  true  false  false')",
	"lines.pop()",
	"tabs[0].name+='\\nspoof'",
	"tabs[0].selectable_floating_panes_count=0",
	"delete tabs[0].selectable_tiled_panes_count",
	"tabs[0].are_floating_panes_visible='false'",
	"tabs.push({...tabs[0]})",
	"lines[1]=lines[1].replace('terminal_2','terminal_9007199254740992')",
	"lines[1]=lines[1].replace('worker  title','\\x1b[31mworker')",
])("rejects ambiguous, injected, stale or unsupported table metadata: %s", (setup) => {
	// Mutable locals in this case keep malformed fixture setup explicit.
	const code = `let tabs=${JSON.stringify(tabs)}, lines=${JSON.stringify(lines)}, header=${JSON.stringify(header)};${setup};process.stdout.write(JSON.stringify(parsePaneTable(header+'\\n'+lines.join('\\n')+'\\n',tabs)));`;
	const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import {parsePaneTable} from ${JSON.stringify(url)};${code}`], { encoding: "utf8", env: paneChildEnv() });
	expect(JSON.parse(output)).toBeNull();
});

it("uses only cheap tab JSON and pane table for advisory focus checks", () => {
	expect(probe(`const calls=[];
const nav=createNavigator({sessionName:'S',paneId:99},args=>{calls.push(args);return args.includes('list-tabs')?JSON.stringify(tabs):table;});
const context=await nav.inspect(undefined,true);
process.stdout.write(JSON.stringify({focused:context.own.is_focused,calls}));`)).toEqual({ focused: true, calls: [
		["--session", "S", "action", "list-tabs", "--json"],
		["--session", "S", "action", "list-panes", "--state", "--tab"],
	] });
});

it("handles Zellij's suppressed plugin row without promoting the projection to authority", () => {
	expect(probe(`const withPlugin=header+'\\n1  0  tab  with spaces  plugin_0  plugin  (.) - zellij:link  false  false  false\\n'+lines.join('\\n')+'\\n';
process.stdout.write(JSON.stringify(parsePaneTable(withPlugin,tabs).map(p=>p.id)));`)).toEqual([0, 99, 2]);
});

it("never uses an advisory positive focus hint to authorize an action", () => {
	expect(probe(`const calls=[];
const row={id:'agent',state:'live',status:'waiting',heartbeat:Date.now(),navigation:{cwd:'/work',zellij:{sessionName:'S',paneId:2}}};
const nav=createNavigator({sessionName:'S',paneId:99},args=>{calls.push(args);if(args.includes('list-tabs'))return JSON.stringify(tabs);return args.includes('--all')?JSON.stringify([{id:99,tab_id:1,is_plugin:false,is_focused:false},{id:2,tab_id:1,is_plugin:false,pane_cwd:'/work'}]):table;});
const advisory=await nav.inspect(undefined,true); const result=await nav.focus(row,[row]);
process.stdout.write(JSON.stringify({hint:advisory.own.is_focused,result,mutations:calls.filter(a=>a.includes('focus-pane-id')).length}));`)).toEqual({ hint: true, result: "navigation unavailable", mutations: 0 });
});

it("falls back to full structured metadata on table ambiguity, never approximates focus", () => {
	expect(probe(`const calls=[];
const nav=createNavigator({sessionName:'S',paneId:99},args=>{calls.push(args);if(args.includes('list-tabs'))return JSON.stringify(tabs);return args.includes('--all')?JSON.stringify([{id:99,tab_id:1,is_plugin:false,is_focused:false}]):table+lines[0]+'\\n';});
const context=await nav.inspect(undefined,true);
process.stdout.write(JSON.stringify({focused:context.own.is_focused,full:calls.filter(a=>a.includes('--all')).length}));`)).toEqual({ focused: false, full: 1 });
});

it.each([false, true])("stops cancelled metadata chains without launching another query (advisory=%s)", (advisory) => {
	expect(probe(`const calls=[],controller=new AbortController();
const nav=createNavigator({sessionName:'S',paneId:99},args=>{calls.push(args);controller.abort();return JSON.stringify(args.includes('list-tabs')?tabs:[{id:99,tab_id:1,is_plugin:false,is_focused:true},{id:2,tab_id:1,is_plugin:false,is_floating:true}]);});
const result=await nav.inspect(controller.signal,${advisory});
process.stdout.write(JSON.stringify({result,calls:calls.length}));`)).toEqual({ result: null, calls: 1 });
});

it("keeps actual pane cwd and unselectable-pane receipts on full JSON", () => {
	expect(probe(`const calls=[], panes=[{id:99,tab_id:1,is_plugin:false,is_focused:true},{id:2,tab_id:1,is_plugin:false,pane_cwd:'/work'}];
const row={id:'agent',state:'live',status:'waiting',heartbeat:Date.now(),navigation:{cwd:'/work',zellij:{sessionName:'S',paneId:2}}};
const nav=createNavigator({sessionName:'S',paneId:99},args=>{calls.push(args);if(args.includes('close-pane'))panes[1].is_selectable=false;return JSON.stringify(panes);});
const result=await nav.close(row,[row]);
process.stdout.write(JSON.stringify({result,full:calls.filter(a=>a.includes('--all')).length,fast:calls.some(a=>a.includes('--state'))}));`)).toEqual({ result: "Close not verified", full: 2, fast: false });
});

it.each(["cancel", "duplicate", "expired", "changed-cwd"])("revalidates %s after an asynchronous preflight before dispatch", (mode) => {
	expect(probe(`const calls=[], controller=new AbortController();
const panes=[{id:99,tab_id:1,is_plugin:false,is_focused:true},{id:2,tab_id:1,is_plugin:false,pane_cwd:'/work'}];
const row={id:'agent',state:'live',status:'waiting',heartbeat:Date.now(),navigation:{cwd:'/work',zellij:{sessionName:'S',paneId:2}}},rows=[row];
const mode=${JSON.stringify(mode)};
const nav=createNavigator({sessionName:'S',paneId:99},async args=>{calls.push(args);await Promise.resolve();if(mode==='cancel')controller.abort();if(mode==='duplicate')rows.push({...row,id:'other'});if(mode==='changed-cwd')row.navigation.cwd='/different';return JSON.stringify(panes);});
const result=await nav.focus(row,rows,undefined,{signal:controller.signal,refresh:()=>mode==='expired'?null:{row,rows}});
process.stdout.write(JSON.stringify({refused:typeof result==='string',mutations:calls.filter(a=>a.includes('focus-pane-id')).length}));`)).toEqual({ refused: true, mutations: 0 });
});

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { paneChildEnv } from "./helpers.js";

const url = pathToFileURL(resolve("agent-hub-pane/pi-agents-pane-mcp.mjs")).href;
function probe(code: string): unknown {
	return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
import { readMcpConfig, startHubMcp } from ${JSON.stringify(url)};
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
${code}
`], { encoding: "utf8", timeout: 30000, env: paneChildEnv() }));
}

it("requires a private, bounded, non-symlinked MCP config and rejects unknown options", () => {
	expect(probe(`
const root=mkdtempSync(join(tmpdir(),'pane-mcp-config-')), file=join(root,'config.json');
const config={port:49152,bearerToken:'a'.repeat(64),maxPanes:8};
const rejected=()=>{try{readMcpConfig(file);return false}catch{return true}};
try {
 writeFileSync(file,JSON.stringify(config),{mode:0o600});
 const valid=readMcpConfig(file).maxPanes===8;
 chmodSync(file,0o644); const publicFile=rejected(); chmodSync(file,0o600);
 chmodSync(root,0o755); const publicDir=rejected(); chmodSync(root,0o700);
 const alias=join(root,'alias');linkSync(file,alias);const hardlink=rejected();rmSync(alias);
 writeFileSync(file,JSON.stringify({...config,tabId:3}));const extra=rejected();
 writeFileSync(file,' '.repeat(4097));const oversized=rejected();
 rmSync(file);symlinkSync('/does/not/exist',file);const link=rejected();
 process.stdout.write(JSON.stringify({valid,publicFile,publicDir,hardlink,extra,oversized,link}));
} finally {rmSync(root,{recursive:true,force:true})}
`)).toEqual({ valid: true, publicFile: true, publicDir: true, hardlink: true, extra: true, oversized: true, link: true });
});

it("authenticates loopback MCP, validates tools, deduplicates requests, and rejects stale owner instances", () => {
	expect(probe(`
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const token='b'.repeat(64), instance=randomUUID(), base='http://127.0.0.1:'+port+'/mcp';
let creates=0,closes=0,leads=0;
const sidebar=await startHubMcp({port,bearerToken:token,maxPanes:8},{
 list:async()=>({status:'ok',agents:[{id:'lead',name:'lead'}]}),
 create:async({name})=>{creates++;await new Promise(r=>setTimeout(r,20));return {status:'pane_created',name}},
 close:async()=>{closes++;return {status:'confirmation_required'}},
 lead:async()=>{leads++;return {status:'ok'}},
},instance);
const client=new Client({name:'fixture',version:'1'});
const auth={Authorization:'Bearer '+token};
const post=(body,headers={})=>fetch(base,{method:'POST',headers:{...auth,'Content-Type':'application/json',...headers},body});
try {
 const unauth=(await fetch(base)).status;
 const wrong=(await post('{}',{Authorization:'Bearer '+'c'.repeat(64)})).status;
 const origin=(await post('{}',{Origin:'https://fixture.invalid'})).status;
 const host=await new Promise((resolve,reject)=>{const req=httpRequest(base,{method:'POST',headers:{...auth,Host:'fixture.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end('{}')});
 const method=(await fetch(base,{headers:auth})).status;
 const malformed=(await post('not json')).status;
 const batch=(await post('[]')).status;
 const oversized=(await post(' '.repeat(16385))).status;
 await client.connect(new StreamableHTTPClientTransport(new URL(base),{requestInit:{headers:auth}}));
 const tools=(await client.listTools()).tools.map(t=>t.name).sort();
 const list=await client.callTool({name:'hub_list_agents',arguments:{}});
 const args={instance_id:instance,request_id:'one',name:'worker'};
 const [first,retry]=await Promise.all([client.callTool({name:'hub_create_agent',arguments:args}),client.callTool({name:'hub_create_agent',arguments:args})]);
 const mismatch=await client.callTool({name:'hub_create_agent',arguments:{...args,name:'other'}});
 const stale=await client.callTool({name:'hub_create_agent',arguments:{...args,instance_id:randomUUID(),request_id:'stale'}});
 const injection=await client.callTool({name:'hub_create_agent',arguments:{...args,request_id:'inject',tab_id:2}});
 const close=await client.callTool({name:'hub_close_agent',arguments:{instance_id:instance,request_id:'close',agent_id:'lead'}});
 await client.callTool({name:'hub_set_lead',arguments:{instance_id:instance,request_id:'lead',agent_id:'lead'}});
 process.stdout.write(JSON.stringify({unauth,wrong,origin,host,method,malformed,batch,oversized,tools,
  instance:list.structuredContent.instance_id===instance,creates,closes,leads,
  same:JSON.stringify(first)===JSON.stringify(retry),mismatch:mismatch.isError,stale:stale.isError,injection:injection.isError,
  close:close.structuredContent.status}));
} finally {await client.close();sidebar.close()}
`)).toEqual({
		unauth: 401, wrong: 401, origin: 403, host: 403, method: 405,
		malformed: 400, batch: 400, oversized: 413,
		tools: ["hub_close_agent", "hub_create_agent", "hub_list_agents", "hub_set_lead"],
		instance: true, creates: 1, closes: 1, leads: 1, same: true,
		mismatch: true, stale: true, injection: true, close: "confirmation_required",
	});
}, 35000);

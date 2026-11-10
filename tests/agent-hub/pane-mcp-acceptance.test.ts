import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { paneChildEnv } from "./helpers.js";

it("runs MCP and keyboard through one sidebar, pins its tab, and keeps close human-confirmed", () => {
	const dir = mkdtempSync(join(tmpdir(), "pane-mcp-acceptance-"));
	try {
		const result = spawnSync("python3", ["-c", String.raw`
import os, pty, subprocess, select, time, json, sys, socket, http.client, fcntl, termios, struct
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
root=Path(sys.argv[2]);registry=root/'agents';registry.mkdir()
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
token='d'*64
config=root/'mcp.json';config.write_text(json.dumps(dict(port=port,bearerToken=token,maxPanes=6)));config.chmod(0o600)
base=dict(pid=os.getpid(),startedAt=int(time.time()*1000),heartbeat=int(time.time()*1000),status='waiting',model='fixture/model')
for name,pane,tab,cwd in [('lead',2,1,'/work'),('helper',3,1,'/helper'),('foreign',4,2,'/foreign')]:
 row=dict(base,id=name,name=name,cwd=cwd,zellij=dict(sessionName='fixture',paneId=pane))
 if name!='lead':row['namespace']='lead'
 else:row['declared_name']='lead'
 (registry/(name+'.json')).write_text(json.dumps(row))
stub=root/'zellij'
stub.write_text('''#!'''+sys.executable+'''
import json,os,sys,time,subprocess
from pathlib import Path
root=Path('''+repr(str(root))+''');args=sys.argv[1:];action=args[3]
with (root/'calls').open('a') as f:f.write(json.dumps(args)+chr(10))
if action=='list-panes':
 if (root/'slow').exists():time.sleep(.5)
 p=[dict(id=99,tab_id=2 if (root/'moved').exists() else 1,is_plugin=False,is_focused=(root/'focused').exists(),pane_cwd='/view')]
 for name,pane,tab,cwd in [('lead',2,1,'/work'),('helper',3,1,'/helper'),('foreign',4,2,'/foreign')]:
  if (root/('closed-'+str(pane))).exists():continue
  p.append(dict(id=pane,tab_id=tab,is_plugin=False,pane_cwd=cwd,is_selectable=True))
 for file in root.glob('created-*.json'):p.append(json.loads(file.read_text()))
 print(json.dumps(p))
elif action=='are-floating-panes-visible':print('false')
elif action=='new-pane':
 # Execute only the fixed env scrub prefix with a harmless fixture Python child.
 prefix=args[args.index('--')+1:args.index('pi')]
 check=subprocess.check_output(prefix+[sys.executable,'-c',"import os;print('HUB_SIDEBAR_TOKEN' in os.environ)"])
 (root/'child-token-present').write_bytes(check)
 pane=7+len(list(root.glob('created-*.json')))
 tab=int(args[args.index('--tab-id')+1]);name=args[args.index('--name')+1];cwd=args[args.index('--cwd')+1]
 (root/('created-'+str(pane)+'.json')).write_text(json.dumps(dict(id=pane,tab_id=tab,is_plugin=False,is_floating=True,pane_cwd=cwd)))
 row=dict(id=name,name=name,pid=os.getppid(),startedAt=int(time.time()*1000),heartbeat=int(time.time()*1000),status='waiting',cwd=cwd,namespace='lead',zellij=dict(sessionName='fixture',paneId=pane))
 (root/'agents'/(name+'.json')).write_text(json.dumps(row))
 if (root/'uncertain').exists():time.sleep(.3)
 print('bad receipt' if (root/'uncertain').exists() else 'terminal_'+str(pane))
elif action=='close-pane':
 pane=int(args[args.index('--pane-id')+1].split('_')[1]);(root/('closed-'+str(pane))).touch()
 if pane==3:(root/'agents/helper.json').unlink()
else:raise SystemExit(2)
''');stub.chmod(0o755)
master,slave=pty.openpty();before=termios.tcgetattr(slave)
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0))
env=dict(os.environ,HUB_SIDEBAR_TOKEN='fixture-sidebar-capability',PI_AGENTS_PANE_STARTUP_DELAY='0',ZELLIJ='0',ZELLIJ_SESSION_NAME='fixture',ZELLIJ_PANE_ID='99',PATH=str(root)+os.pathsep+os.environ['PATH'])
p=subprocess.Popen([sys.argv[1],'--scope','lead','--registry',str(registry),'--interval','0.25','--no-color','--mcp-config',str(config)],stdin=slave,stdout=slave,stderr=slave,env=env)
data=b''
def until(text,timeout=5):
 global data
 deadline=time.monotonic()+timeout
 while text not in data and time.monotonic()<deadline:
  if select.select([master],[],[],.02)[0]:data+=os.read(master,65536)
 assert text in data,(text,repr(data))
def rpc(name,args):
 conn=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
 body=json.dumps(dict(jsonrpc='2.0',id=1,method='tools/call',params=dict(name=name,arguments=args)))
 conn.request('POST','/mcp',body,{'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'})
 res=conn.getresponse();raw=res.read().decode();conn.close()
 assert res.status==200,(res.status,raw)
 if raw.startswith('event:'):raw=next(line[6:] for line in raw.splitlines() if line.startswith('data: '))
 reply=json.loads(raw)
 assert 'result' in reply,reply
 return reply['result']
def calls(action):
 return [a for a in map(json.loads,(root/'calls').read_text().splitlines()) if a[3]==action]
try:
 until(b'Sidebar MCP enabled')
 # Filtering out a bad lead must never silently promote the next valid sibling.
 lead_path=registry/'lead.json';lead_record=json.loads(lead_path.read_text())
 lead_path.write_text(json.dumps(dict(lead_record,cwd='/wrong')))
 invalid=rpc('hub_list_agents',{})['structuredContent']
 assert {a['id'] for a in invalid['agents']}=={'helper'} and not any(a['lead'] for a in invalid['agents']),invalid
 lead_path.write_text(json.dumps(lead_record))
 state=rpc('hub_list_agents',{})['structuredContent'];epoch=state['instance_id']
 assert {a['id'] for a in state['agents']}=={'lead','helper'},state
 def args(id,**extra):return dict(instance_id=epoch,request_id=id,**extra)
 assert rpc('hub_set_lead',args('foreign',agent_id='foreign'))['isError']
 assert rpc('hub_set_lead',args('choose',agent_id='helper'))['structuredContent']['status']=='ok'
 create=args('new',name='worker')
 assert rpc('hub_create_agent',create)['structuredContent']['status']=='pane_created'
 assert rpc('hub_create_agent',create)['structuredContent']['status']=='pane_created'
 launch=calls('new-pane');assert len(launch)==1,launch
 assert launch[0][launch[0].index('--tab-id')+1]=='1'
 assert launch[0][launch[0].index('--cwd')+1]=='/helper'
 assert 'PI_MATRIX_DISABLED=1' in launch[0] and '--models' not in launch[0]
 assert 'PI_PANOPTICON_PARENT_ID' in launch[0] and 'PI_PANOPTICON_NAMESPACE=lead' in launch[0]
 assert 'HUB_SIDEBAR_TOKEN' in launch[0] and (root/'child-token-present').read_text().strip()=='False'
 # Quota counts all terminal panes, including unregistered shells and the sidebar.
 for pane in [50,51]:(root/('created-quota-'+str(pane)+'.json')).write_text(json.dumps(dict(id=pane,tab_id=1,is_plugin=False)))
 quota=rpc('hub_create_agent',args('quota',name='overflow'))['structuredContent']
 assert quota['status']=='refused' and len(calls('new-pane'))==1,quota
 for pane in [50,51]:(root/('created-quota-'+str(pane)+'.json')).unlink()
 # A keyboard cancellation interrupts an MCP preflight, never queues a new form.
 (root/'slow').touch();before_queries=len(calls('list-panes'))
 with ThreadPoolExecutor() as pool:
  pending=pool.submit(rpc,'hub_list_agents',{})
  deadline=time.monotonic()+2
  while len(calls('list-panes'))==before_queries and time.monotonic()<deadline:time.sleep(.005)
  assert len(calls('list-panes'))>before_queries
  os.write(master,b'n')
  assert pending.result()['isError']
 (root/'slow').unlink()
 assert len(calls('new-pane'))==1
 # MCP requests a close; only separate physical keyboard actions may execute it.
 close=rpc('hub_close_agent',args('close',agent_id='helper'))['structuredContent']
 assert close['status']=='confirmation_required' and not calls('close-pane'),close
 (root/'focused').touch();os.write(master,b'c');until(b'Close #3 [W] Y/n helper')
 os.write(master,b'y');until(b'selected agent left the registry');assert len(calls('close-pane'))==1
 # Registry removal can render before the receipt query finishes. Wait for the
 # shared slot, then prove the keyboard selection moved rather than guessing a delay.
 deadline=time.monotonic()+3
 while rpc('hub_list_agents',{})['structuredContent']['status']!='ok':
  assert time.monotonic()<deadline
  time.sleep(.01)
 data=b'';os.write(master,b'k');until(b'\x1b[7mW lead')
 assert rpc('hub_set_lead',args('choose-lead',agent_id='lead'))['structuredContent']['status']=='ok'
 # The capability is pinned to startup tab 1, even if this sidebar moves.
 (root/'moved').touch()
 moved=rpc('hub_create_agent',args('moved',name='other'))['structuredContent']
 assert moved['status']=='refused' and moved['reason']=='navigation unavailable',moved
 assert len(calls('new-pane'))==1
 (root/'moved').unlink()
 (root/'uncertain').touch()
 # A keyboard launch is already dispatched: n cannot undo it or permit another.
 data=b'';os.write(master,b'n');until(b'Name: ')
 os.write(master,b'unknown');until(b'Name: unknown');os.write(master,b'\r');until(b'Default model? Y/n unknown')
 os.write(master,b'y');deadline=time.monotonic()+2
 while len(calls('new-pane'))<2 and time.monotonic()<deadline:time.sleep(.005)
 assert len(calls('new-pane'))==2
 os.write(master,b'n');until(b'Action sent; verifying receipt');until(b'Agent launch uncertain; check panes')
 assert rpc('hub_list_agents',{})['structuredContent']['mutations_inhibited']
 assert rpc('hub_create_agent',args('inhibited',name='blocked'))['isError']
 assert len(calls('new-pane'))==2
 # The keyboard uses the same inhibited mutation slot, not another launcher.
 data=b'';os.write(master,b'n');until(b'Name: ');os.write(master,b'keyboard');until(b'Name: keyboard');os.write(master,b'\r')
 until(b'Default model? Y/n keyboard');data=b'';os.write(master,b'y');until(b'Uncertain mutation; inspect panes before recovery')
 assert len(calls('new-pane'))==2
 os.write(master,b'q');assert p.wait(timeout=2)==0
 assert termios.tcgetattr(slave)==before
 try:
  socket.create_connection(('127.0.0.1',port),timeout=.2)
  raise AssertionError('MCP listener survived sidebar exit')
 except ConnectionRefusedError:pass
 print('same-tab MCP/keyboard operations; replay refused; close confirmed by human; uncertainty inhibits both; terminal restored')
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master);os.close(slave)
`, resolve("agent-hub-pane/pi-agents-pane"), dir], { encoding: "utf8", timeout: 25000, env: paneChildEnv() });
		expect(result.error ?? result.status, result.stderr || result.stdout).toBe(0);
		expect(result.stdout).toContain("uncertainty inhibits both; terminal restored");
	} finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);

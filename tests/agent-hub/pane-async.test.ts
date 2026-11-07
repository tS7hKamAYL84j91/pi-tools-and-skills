import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { paneChildEnv } from "./helpers.js";

it("keeps slow navigation cancellable, rejects stale approvals, and never overlaps modal/action queries", () => {
	const dir = mkdtempSync(join(tmpdir(), "pane-async-"));
	try {
		const result = spawnSync("python3", ["-c", `
import os, pty, subprocess, select, time, json, sys, fcntl, termios, struct
from pathlib import Path
root=Path(sys.argv[2]); registry=root/'agents'; registry.mkdir()
base=dict(pid=os.getpid(),startedAt=int(time.time()*1000),heartbeat=int(time.time()*1000),status='waiting',model='fixture/model',cwd='/work')
for name,pane in [('lead',2),('helper',3)]:
    row=dict(base,id=name,name=name,zellij=dict(sessionName='fixture',paneId=pane))
    if name=='helper': row['namespace']='lead'
    else: row['declared_name']='lead'
    (registry/(name+'.json')).write_text(json.dumps(row))
stub=root/'zellij'
stub.write_text('''#!'''+sys.executable+'''
import json, os, signal, sys, time
from pathlib import Path
root=Path('''+repr(str(root))+''')
args=sys.argv[1:]
def log(kind):
    with (root/'calls').open('a') as f: f.write(json.dumps(dict(kind=kind,pid=os.getpid(),action=args[3]))+chr(10))
def stop(*args): raise SystemExit(143)
signal.signal(signal.SIGTERM,stop)
log('start')
try:
    if 'list-panes' in args:
        time.sleep(0.65)
        print(json.dumps([dict(id=99,tab_id=1,is_plugin=False,is_focused=True,pane_cwd='/view'),dict(id=2,tab_id=1,is_plugin=False,pane_cwd='/work'),dict(id=3,tab_id=1,is_plugin=False,pane_cwd='/work')]),flush=True)
    elif 'focus-pane-id' in args: (root/'focused').touch()
    elif 'close-pane' in args: (root/'closed').touch()
finally: log('end')
''')
stub.chmod(0o755)
master,slave=pty.openpty(); before=termios.tcgetattr(slave)
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',20,100,0,0))
env=dict(os.environ,PI_AGENTS_PANE_STARTUP_DELAY='0',ZELLIJ='0',ZELLIJ_SESSION_NAME='fixture',ZELLIJ_PANE_ID='99',PATH=str(root)+os.pathsep+os.environ['PATH'])
p=subprocess.Popen([sys.argv[1],'--scope','lead','--registry',str(registry),'--interval','0.25','--no-color'],stdin=slave,stdout=slave,stderr=slave,env=env)
data=b''
def until(text,timeout=3):
    global data
    deadline=time.monotonic()+timeout
    while text not in data and time.monotonic()<deadline:
        if select.select([master],[],[],0.02)[0]: data+=os.read(master,65536)
    assert text in data, repr(data)
def calls():
    return [json.loads(s) for s in (root/'calls').read_text().splitlines()] if (root/'calls').exists() else []
def active():
    events=calls(); return sum(1 if e['kind']=='start' else -1 for e in events)
def wait_active():
    deadline=time.monotonic()+2
    while active()!=1 and time.monotonic()<deadline: time.sleep(0.005)
    assert active()==1, calls()
def reset():
    global data
    while select.select([master],[],[],0)[0]: os.read(master,65536)
    data=b''
try:
    until(b'l:lead q:quit')
    # Move cancels a slow focus preflight immediately; no queued mutation later.
    os.write(master,b'\\r\\r'); wait_active(); reset()
    # Release/no-op and split paste chunks must neither repaint nor become actions.
    os.write(master,b'\\x1b[<0;8;3m\\x1b[')
    time.sleep(0.02)
    os.write(master,b'200~qcy\\r\\x1b[201~')
    assert not select.select([master],[],[],0.1)[0], 'no-op input repainted pending state'
    assert p.poll() is None and not (root/'closed').exists()
    started=time.monotonic(); os.write(master,b'j'); until(b'Action cancelled',0.4)
    assert time.monotonic()-started<0.4
    time.sleep(0.1)
    assert not (root/'focused').exists()
    os.write(master,b'k'); time.sleep(0.05)
    # Confirmation sent before the arming query completes is not replayed.
    reset(); os.write(master,b'c'); wait_active(); os.write(master,b'y')
    until(b'Action pending; input not queued'); until(b'Close #2 [W] Y/n lead')
    assert not (root/'closed').exists()
    # A record change during the actual confirmed preflight revokes approval.
    reset(); os.write(master,b'y'); until(b'Checking pane')
    path=registry/'lead.json'; row=json.loads(path.read_text()); row['name']='renamed'; path.write_text(json.dumps(row))
    until(b'Action cancelled: agent changed')
    assert not (root/'closed').exists()
    row['name']='lead'; path.write_text(json.dumps(row))
    # Finish/discard an already-running modal check before fresh action inspection.
    reset(); os.write(master,b'n'); until(b'Name:'); wait_active()
    reset(); os.write(master,b'\\x1b'); until(b'New agent cancelled')
    os.write(master,b'\\r')
    deadline=time.monotonic()+3
    while not (root/'focused').exists() and time.monotonic()<deadline: time.sleep(0.01)
    assert (root/'focused').exists(), calls()
    time.sleep(0.1)
    # The advertised n cancellation must not turn into a queued new-agent form.
    reset(); os.write(master,b'\\r'); wait_active(); reset()
    os.write(master,b'n'); until(b'Action cancelled',0.4)
    assert b'Name:' not in data
    deadline=time.monotonic()+1
    while active() and time.monotonic()<deadline: time.sleep(0.01)
    assert active()==0
    time.sleep(0.05)
    # Quit also aborts a pending subprocess rather than waiting its deadline.
    reset(); os.write(master,b'\\r'); wait_active(); reset()
    started=time.monotonic(); os.write(master,b'q'); until(b'\\x1b[?25h',0.4)
    assert p.wait(timeout=0.5)==0
    assert time.monotonic()-started<0.5
    assert termios.tcgetattr(slave)==before
    running=set(); maximum=0
    for event in calls():
        if event['kind']=='start': running.add(event['pid'])
        else: running.remove(event['pid'])
        maximum=max(maximum,len(running))
    assert maximum==1 and not running, ('overlapping or unreaped processes',calls())
    print('responsive cancellation; stale approval refused; max in-flight=1; terminal restored')
finally:
    if p.poll() is None: p.kill(); p.wait()
    os.close(master); os.close(slave)
`, resolve("agent-hub-pane/pi-agents-pane"), dir], { encoding: "utf8", timeout: 15_000, env: paneChildEnv() });
		expect(result.error ?? result.status, result.stderr || result.stdout).toBe(0);
		expect(result.stdout).toContain("max in-flight=1; terminal restored");
	} finally { rmSync(dir, { recursive: true, force: true }); }
}, 20_000);

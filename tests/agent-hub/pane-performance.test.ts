import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { paneChildEnv } from "./helpers.js";

it("keeps idle polling subprocess-free, repaints changed lines, and rechecks focus before arming", () => {
	const dir = mkdtempSync(join(tmpdir(), "pane-performance-"));
	try {
		const result = spawnSync("python3", ["-c", `
import os, pty, subprocess, select, time, json, sys, fcntl, termios, struct
from pathlib import Path
root = Path(sys.argv[2])
registry = root / 'agents'
registry.mkdir()
base = dict(pid=os.getpid(), startedAt=int(time.time()*1000), heartbeat=int(time.time()*1000), status='waiting', model='fixture/model', cwd=str(root))
for name, pane in [('lead', 2), ('helper', 3)]:
    row = dict(base, id=name, name=name, zellij=dict(sessionName='fixture', paneId=pane))
    if name == 'helper': row['namespace'] = 'lead'
    (registry / (name+'.json')).write_text(json.dumps(row))
stub = root / 'zellij'
stub.write_text('''#!'''+sys.executable+'''
import sys, json, time
from pathlib import Path
root = Path('''+repr(str(root))+''')
with (root / 'calls').open('a') as f: f.write(json.dumps(sys.argv[1:])+chr(10))
if (root/'fail').exists(): sys.exit(1)
if 'close-pane' in sys.argv:
    (root/'closed').touch()
elif 'list-panes' in sys.argv:
    if (root/'slow-close').exists():
        counter = root/'slow-count'
        count = int(counter.read_text())+1 if counter.exists() else 1
        counter.write_text(str(count))
        if count == 1:
            (root/'background-started').touch()
            time.sleep(1.0)
            print('invalid inspection'); sys.exit(0)
        elif count in (2,3): time.sleep(0.6)
    rows = [dict(id=99,tab_id=1,is_plugin=False,is_focused=not (root/'away').exists(),pane_cwd=str(root)), dict(id=2,tab_id=1,is_plugin=False,pane_cwd=str(root)), dict(id=3,tab_id=1,is_plugin=False,pane_cwd=str(root))]
    print(json.dumps([row for row in rows if row['id'] != 2 or not (root/'closed').exists()]))
''')
stub.chmod(0o755)
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 100, 0, 0))
env = dict(os.environ, PI_AGENTS_PANE_STARTUP_DELAY='0', ZELLIJ='0', ZELLIJ_SESSION_NAME='fixture', ZELLIJ_PANE_ID='99', PATH=str(root)+os.pathsep+os.environ['PATH'])
p = subprocess.Popen([sys.argv[1], '--scope', 'lead', '--registry', str(registry), '--interval', '0.25', '--no-color'], stdin=slave, stdout=slave, stderr=slave, env=env)
data = b''
def until(needle):
    global data
    deadline = time.monotonic()+3
    while needle not in data and time.monotonic()<deadline:
        if select.select([master],[],[],0.05)[0]: data += os.read(master,65536)
    assert needle in data, repr(data)
def calls():
    return [json.loads(line) for line in (root/'calls').read_text().splitlines()]
def update(model):
    path = registry/'helper.json'
    row = json.loads(path.read_text())
    row['model'] = model
    path.write_text(json.dumps(row))
try:
    until(b'l:lead q:quit')
    data = b''
    assert not select.select([master],[],[],0.8)[0], 'idle repaint'
    assert calls() == [['--session', 'fixture', 'action', 'list-panes', '--json', '--all']], ('idle Zellij subprocesses', calls())
    update('fixture/updated-model')
    until(b'updated-model')
    assert b'\\x1b[2J' not in data, 'small update cleared whole pane'
    assert b'lead' not in data and b'q:quit' not in data, 'unchanged lines repainted'
    data = b''
    update('fixture/x')
    until(b'helper')
    assert b'\\x1b[2K' in data, 'shortened line not cleared'
    assert len(calls()) == 1, 'registry updates spawned Zellij'
    data = b''
    (registry/'helper.json').unlink()
    until(b'q:quit')
    assert b'\\x1b[4;1H\\x1b[2K' in data, 'removed footer line left stale cells'
    assert b'\\x1b[2J' not in data, 'row removal cleared whole pane'
    # A transient inspection error must refuse arming, not disable mouse/input.
    (root/'fail').touch()
    data = b''
    os.write(master,b'c')
    until(b'No verified pane to close')
    assert b'\\x1b[?1000l' not in data, 'inspection failure disabled mouse'
    os.write(master,b'n')
    time.sleep(0.15)
    while select.select([master],[],[],0)[0]: data += os.read(master,65536)
    assert b'Name:' not in data and b'\\x1b[?1000l' not in data, 'failed inspect armed or disabled input'
    (root/'fail').unlink()
    data = b''
    os.write(master,b'n')
    until(b'Name:')
    os.write(master,b'\\x1b')
    until(b'New agent cancelled')
    # Cached focus is not authority: deny close while away, then accept return immediately.
    (root/'away').touch()
    data = b''
    os.write(master,b'c')
    until(b'No verified pane to close')
    assert not any('close-pane' in call for call in calls())
    assert '--all' in calls()[-1], 'arming skipped authoritative pane inspection'
    (root/'away').unlink()
    data = b''
    os.write(master,b'c')
    until(b'Close #2 [W] Y/n lead')
    os.write(master,b'n')
    until(b'Close cancelled')
    # Name entry must also recheck focus without requiring a background poll.
    (root/'away').touch()
    os.write(master,b'n')
    time.sleep(0.15)
    (root/'away').unlink()
    data = b''
    os.write(master,b'n')
    until(b'Name:')
    os.write(master,b'\\x1b')
    until(b'New agent cancelled')
    # Reproduce an old modal inspection failing behind synchronous close.
    data = b''
    os.write(master,b'c')
    until(b'Close #2 [W] Y/n lead')
    (root/'slow-close').touch()
    deadline = time.monotonic()+2
    while not (root/'background-started').exists() and time.monotonic()<deadline: time.sleep(0.01)
    assert (root/'background-started').exists(), 'no in-flight modal check'
    data = b''
    os.write(master,b'y')
    until(b'Pane closed: lead')
    deadline = time.monotonic()+0.4
    while time.monotonic()<deadline:
        if select.select([master],[],[],0.05)[0]: data += os.read(master,65536)
    assert b'\\x1b[?1000l' not in data, 'stale modal failure disabled input after close'
    data = b''
    os.write(master,b'n')
    until(b'Name:')
    os.write(master,b'\\x1b')
    until(b'New agent cancelled')
    os.write(master,b'q')
    assert p.wait(timeout=2)==0
    print('idle=0 subprocesses; changed-lines-only; fresh arming checks')
finally:
    if p.poll() is None: p.kill(); p.wait()
    os.close(master); os.close(slave)
`, resolve("agent-hub-pane/pi-agents-pane"), dir], {
			encoding: "utf8", timeout: 12_000, env: paneChildEnv(),
		});
		expect(result.error ?? result.status, result.stderr || result.stdout).toBe(0);
		expect(result.stdout).toContain("idle=0 subprocesses; changed-lines-only; fresh arming checks");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 15_000);

# Integrate Kanban Monitor into Pi as Proper Extension

## Task ID: T-054
## Agent Name: kanban-monitor-extension

## Objective
Take the proof-of-concept `kanban-monitor.sh` script and integrate it properly into the pi ecosystem as a first-class extension.

## POC Location
- Script: `/Users/jim/git/coas/kanban/scripts/kanban-monitor.sh`
- Log: `/Users/jim/git/coas/kanban/monitor.log`

## Current POC Features
- Monitors in-progress kanban tasks
- Detects DONE (via REPORT.md), BLOCKED, STALLED states
- Uses tmux pane content hashing for stall detection
- Configurable: `--interval N`, `--once`, `--verbose`, `--stall-cycles N`
- Logs to monitor.log
- Alerts to COMMUNICATION.md when issues detected

## Integration Options

### Option 1: Pi Extension (Recommended)
Create a proper pi extension at `~/git/tools-and-skills/extensions/kanban-monitor.ts`:
- Register as `kanban-monitor` tool
- Expose as `kanban_monitor()` function in pi sessions
- Support both standalone and background modes
- Integrate with existing `kanban_snapshot`, `agent_peek` tools

### Option 2: Enhanced Kanban Scripts
Keep as shell script but:
- Move to `tools-and-skills/extensions/kanban/scripts/`
- Add proper error handling
- Add `--prod` flag to nudge stalled agents
- Add `--alert` flag to write alerts
- Document in AGENTS.md

### Option 3: Hybrid
- Core monitoring as extension
- Shell wrapper for cron/background use

## Requirements

### Must Have
1. Works with existing kanban board.log system
2. Detects stalled agents (no progress for N cycles)
3. Only alerts/prods when truly stuck (trust but verify)
4. Logs all checks for audit trail

### Should Have
1. `--prod` mode: sends message to stalled agents asking for status
2. `--auto-complete` mode: marks tasks done if REPORT.md exists
3. Integration with pi's tool system (callable from agent)

### Nice to Have
1. Web/dashboard view of task status
2. Metrics: average task duration, stall rate, etc.
3. Auto-expire stale claims (TTL enforcement)

## Design Considerations

### "Trust but Verify" Principle
- Agents should self-report progress via `kanban-note.sh`
- Monitor only checks periodically (e.g., every 5 minutes)
- Only prod/interrupt if no progress for multiple cycles
- Respect agent autonomy - don't micromanage

### Stall Detection Improvements
Current POC uses pane content hashing. Consider also:
- Last NOTE event timestamp from board.log
- Last file modification time in agent's directory
- Agent heartbeat file (agent writes timestamp periodically)

## Deliverables
1. Working extension in `tools-and-skills/extensions/kanban-monitor.ts`
2. Documentation in extension README
3. Update to AGENTS.md explaining monitoring workflow
4. Test with real in-progress tasks

## Resources
- POC script: `/Users/jim/git/coas/kanban/scripts/kanban-monitor.sh`
- Pi extension examples: `~/git/tools-and-skills/extensions/`
- AGENTS.md: `/Users/jim/git/coas/AGENTS.md`
- Pi docs: `~/github/pi/docs/` (if needed)
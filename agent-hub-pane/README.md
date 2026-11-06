# Agent Hub Zellij Pane

Compact, interactive terminal side pane for Zellij tabs. Shows the tab's lead agent and its namespace helpers from Agent Hub (`~/.pi/agents`).

## Usage

```sh
./agent-hub-pane/pi-agents-pane --scope <canonical-lead> [--registry <dir>] [--interval <seconds>] [--once] [--json] [--no-color]
```

- `--scope <name>`: canonical lead name to display (matches `declared_name` or `name` fallback, plus any agents whose `namespace == scope`).
- `--registry <dir>`: override registry directory (defaults to `~/.pi/agents`).
- `--interval <sec>`: refresh cadence in continuous mode (default: 2 s, range: 0.25..3600). Keyboard/mouse actions remain immediate; the interval controls periodic refresh.
- `PI_AGENTS_PANE_INTERVAL`: env override of the default cadence (0.25..3600); an explicit `--interval` wins, unset or blank keeps the default.
- Startup and steady-state refresh read the registry without spawning Zellij queries. Valid terminal identity enables advisory controls only; actions/active confirmations still revalidate live focus, full pane identity and cwd. Unchanged frames emit nothing; small updates repaint only changed lines.
- `PI_AGENTS_PANE_STARTUP_DELAY`: seconds to pause automatic redraws after the initial frame (default: 20, range: 0..3600; `0` disables). Unset or blank uses the default. Initial interactive controls, keyboard/mouse and resize redraws remain immediate. At expiry the pane refreshes and starts normal polling. One-shot output is not delayed. Set this in the launcher environment; running panes require a restart.
- `--once`: render a single frame and exit.
- `--json`: emit JSON snapshot and exit (implies `--once`).
- `--no-color`: plain text output without ANSI colors.

Exit codes: `0` success, `2` argument error, `3` registry unreadable.

## Interactive Controls (Zellij)

Footer: `n:new c:close l:lead q:quit` (`n+ c- l:lead q:quit` below 27 columns; read-only fallback: `q:quit`).

- **Select row**: `j` / `k` or Up / Down arrows.
- **Focus agent**: `Enter` or left mouse click. Uniquely targets the agent's pane in this tab/session. Reveals/raises hidden floating panes; focusing a tiled pane hides floating panes while agents continue running.
- **Create agent**: `n`, enter a name, press `Enter` to preview, then `Enter` or `y` to confirm. Starts an interactive `pi --name <name>` floating pane in this tab and project directory using Pi's default configured model. Known Matrix credential environment variables are removed and Matrix is disabled. Custom credential variable names may still be inherited from the Zellij server; do not expose secrets there.
- **Close pane**: `c`, verify pane number in prompt, press `Enter` or `y` within 5 seconds to confirm (`n` cancels). Performs a Zellij pane close.
- **Designate lead**: `l` sets the selected agent as the panel-local lead until exit.
- **Quit**: `q` or `Ctrl-C` exits and restores terminal state.

## Testing

Fixture snapshot (offline, no live registry access):

```sh
./agent-hub-pane/pi-agents-pane --scope demo --registry "$PWD/tests/fixtures/agent-hub-pane" --once --json
```

Detached Zellij 0.44.1 acceptance test (creates and cleans up its own scratch session):

```sh
node agent-hub-pane/test-agent-pane-zellij.mjs
```

Bounded attached load test: eight Hub panes across eight disposable tabs, four
synthetic output producers (400 lines/s configured, 45-second lifetime), no model
calls. Verifies all panes become interactive, output advances, idle polls launch
no Zellij queries, and input-driven focus/close/create have real pane receipts.
Reports focus latency including receipt polling; this is not a live-user benchmark.

```sh
node agent-hub-pane/test-agent-pane-zellij.mjs --load          # Python stdlib PTY
node agent-hub-pane/test-agent-pane-zellij.mjs --termwright   # native Termwright PTY required
```

Both paths clean up only their generated session. The Termwright path fails
explicitly if its platform-native addon is unavailable; it does not silently
substitute another driver.

The combined Termwright scale test runs **all groups concurrently in one session**:
one Hub with 10 standing fixture agents and ten Hubs with 1–5 each (40 agents,
51 terminal panes total). All groups share one fixture registry. It verifies
scope isolation, full-size rows, keyboard focus in every group, narrow two-line
paging and mouse focus in the dense group, cancellation, and process cleanup.
Display latency is observed through the attached terminal before querying the
focus receipt, avoiding measurement-induced metadata contention.

```sh
node agent-hub-pane/test-agent-pane-scale.mjs
```

Fixtures are lightweight Python processes, not model workers. Registry polling
uses the normal 2-second interval; only the fixture startup redraw delay is
zeroed. The run has a 150-second deadline and never touches existing sessions.

Termwright 0.7.7 officially supports Node 22/24. On this Node 25 ARM64 host its
optional native addon was omitted by `npm ci`; the matching addon can be installed
locally without changing the lockfile or defaults:

```sh
npm install --no-save --ignore-scripts --no-audit --no-fund @termwright/pty-linux-arm64@0.7.7
```

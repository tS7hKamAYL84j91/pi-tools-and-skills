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
- `PI_AGENTS_PANE_STARTUP_DELAY`: seconds to pause automatic redraws after the initial frame (default: 20, range: 0..3600; `0` disables). Unset or blank uses the default. Keyboard/mouse and resize redraws remain immediate. At expiry the pane refreshes and starts normal polling. One-shot output is not delayed. Set this in the launcher environment; running panes require a restart.
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

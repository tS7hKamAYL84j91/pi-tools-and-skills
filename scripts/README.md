# Scripts

Repository automation. None is loaded by Pi at runtime.

## Checks

- `check-namespace.mjs`, `check-template-safety.mjs` — `npm run check` guards. `check-package-imports.mjs` runs in the CI install/import smoke test and the Goal completion hook, not in `npm run check`.
- `semgrep-scan.mjs` — `npm run security:semgrep`, using [`../rules/`](../rules/README.md).
- `builtins.json` — reserved Pi command names used by the namespace check.

## Agent Hub side pane (PoC)

`/absolute/path/to/pi-tools/scripts/pi-agents-pane --scope <canonical-lead>`

Standalone Node ESM, no dependencies/build/Pi process required; works from any
cwd. Reads `~/.pi/agents`, never consumes inboxes or changes registry files.
Use `--registry <fixture-dir> --once --json` for a one-shot diagnostic. JSON
implies once; unreadable registry exits 3, usage errors exit 2. Default refresh
is two seconds (`--interval 0.25..3600`); q, Ctrl-C, SIGINT or SIGTERM stops the
view. Missing registry in continuous mode is shown and retried. Output is
bounded to terminal width/height. TTY output uses Hub status roles with Pi's
built-in dark-theme RGB palette (running green, waiting purple, blocked/stalled
yellow, terminated red, done dim, unknown muted). `--no-color` and non-TTY
output remain plain; JSON is unchanged. The palette is bundled, not dynamically
loaded from Pi theme settings.
Human output uses the Hub glyph listing: `R - quartermaster - running`, one
line per agent, beneath `<scope> · hub` with a `q quit` footer. Non-resolved
lead state stays in the header. Names truncate first with an ellipsis; at very
narrow widths the status word is dropped. Model, heartbeat, pending count and
session metadata remain in the unchanged JSON snapshot, not the compact rows.

In Zellij, arrows or j/k select a row; Enter or a left mouse click focuses its
uniquely identified terminal in **this tab and session only**. No title/cwd
matching guesses. Focus requires fresh (at most 30 seconds old) heartbeat, live process
evidence and explicit `AgentRecord.zellij` identity. Old records without it
show a notice; load the updated Hub in those agents before using focus. Headless
children do not advertise their parent's terminal. Missing Zellij disables
navigation. Hidden floating agents remain selectable: on Zellij 0.44.1, focusing
one reveals the floating layer and raises that agent. Focusing the tiled view
again hides the floats; agents keep running. Zellij reveals the floating layer,
not exclusively one window—overlapping floating geometry keeps the footprint
small. The view checks layer visibility as well as pane focus before accepting
navigation or redrawing, and restores
mouse reporting/raw mode on exit. Bracketed paste is enabled and ignored, so
pasted text cannot activate navigation or quit. Selection follows the agent ID;
if it disappears, Enter never silently targets a replacement row. It invokes only bounded `zellij list-panes` / `are-floating-panes-visible` queries
and user-triggered `focus-pane-id` commands; agent state is still read-only.
Self-reported identity is not authority; the list/focus race cannot be atomic.

Rows use exact declared lead identity (legacy name fallback only when absent)
and exact namespace membership; external records are excluded. Multiple lead
matches are explicitly ambiguous, not silently resolved by mutable display
name. A dead lead is unavailable; exact-namespace helpers remain visible. Process evidence
(`live/stale/unknown`) is separate from reported status and heartbeat freshness.
Linux `/proc` start time uses a one-sided PID-reuse guard: a record predating
the process by more than 120 seconds is stale. Registration may lag process
startup without an upper bound; missing readable `/proc` yields unknown. No signals are sent to agents. A live PID does not prove progress. JSON carries absolute heartbeat timestamps,
so unchanged fixtures/process evidence produce byte-stable snapshots.
Non-TTY continuous output appends frames, skipping refreshes under backpressure;
a closed output consumer exits cleanly.

Limits: 4,096 directory entries per frame, 64 KiB per record, symlinks and
non-regular files skipped. Invalid records are counted, never removed. Current
session ID comes only from Pi's documented `sessionFile` filename; titles are
unavailable because the registry has no dedicated session-title field. No
session files, transcripts, histories, other processes' environments or inboxes
are read. Only the view's own Zellij identity environment keys are used.
Unicode width is conservative (non-ASCII reserves two cells); read-only frames
show a hidden-lines indicator and the interactive list scrolls with selection. The adapter uses the existing
AgentRecord schema but deliberately does not import Hub's mutating registry
reader or Pi-dependent UI. Tests include an isolated PTY using Python 3; the
executable itself needs only Node.

From this checkout, a safe fixture demo (no live registry access):

```sh
./scripts/pi-agents-pane --scope demo --registry "$PWD/tests/fixtures/agent-hub-pane" --once --json
```

This shows only `demo-session-agent` (lead) and `reviewer` (helper); the unrelated
fixture is excluded. Omit `--json` for the text frame.

Real hidden-floating acceptance (opt-in, requires Zellij 0.44.1):

```sh
node scripts/test-agent-pane-zellij.mjs
```

It creates a uniquely named **detached scratch session**, starts only fixture
Node processes, exercises actual mouse/keyboard input and floating visibility,
then kills only that scratch session and removes its temporary files. It never
attaches to or sends input to your existing session. Regular `npm test` uses
stubs and isolated PTYs, not live Zellij sessions.

See [the bounded specification](../docs/agent-hub-pane-poc.md). Jim authorized the single pi-tools-tab demo; broader rollout and loading the
updated Hub into existing agents require separate approval.

## Setup

- `setup-pi`, `setup-pi-clean` — register or remove this checkout globally, or for one project with `--project <dir>` (see `make help`).
- `pi-package-settings.py` — package-settings helper used by the above.

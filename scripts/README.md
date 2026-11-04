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

**Create an agent:** press `n`, type its name, and press Enter. Review the name
then press Enter or `y` separately to confirm (or `n` to cancel). The
`Y/n` prompt marks Yes as the default; Enter accepts it. A rapid repeated
Enter immediately after name entry is ignored to prevent accidental launch. A new interactive Pi
starts in a floating pane in this tab and the same project directory, with
`pi --name <name>` and no `--model` override: Pi chooses its normal configured
default. The launcher deliberately uses plain `pi` on the Zellij server's PATH,
not CoAS's manifest launcher. Enter a task directly in the new Pi session.
Nothing starts until confirmation. Escape cancels the name entry; Backspace
edits it. Bracketed paste is not supported in the name entry.

The name must use letters, digits, `.`, `_` or `-`, start with a letter/digit,
and be at most 64 characters. Existing live names, declared/spawn aliases,
and reserved lead labels are rejected case-insensitively; the registry/journal
scan must be complete and readable. Names are not reserved by the panel, so a
concurrent claimant may still cause Hub to suffix a name. The lead must be
live, fresh, have a verified pane in the same tab/session and remain unchanged
through confirmation. A tab with 32 or more terminal panes is refused; this
limit does not detect a lower Zellij server `--max-panes` setting. Failed or
ambiguous launch results are reported as uncertain—check the panes before
trying again; there is no automatic retry. Creation uses a shell-free
`zellij action new-pane --floating` argv, with no session/tab creation. The
child receives normalized Hub namespace/spawn-name hints, no inherited parent ID
or session-dir override; Matrix credential environment keys are removed and
`PI_MATRIX_DISABLED=1` is set. This is not an OS-level secret boundary.

The panel automatically prefers a unique exact scope/name match. To designate a
different lead in the panel, select its row with arrows or j/k, then press `l`.
The choice is panel-local and lasts until the panel exits; it never changes
registry identity, CoAS configuration or agent names. If that agent disappears,
the choice is unavailable rather than silently transferred. JSON is unchanged.

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
small. The view keeps status current while unfocused, checks layer visibility
before accepting navigation, and restores
mouse reporting/raw mode on exit. Bracketed paste is enabled and ignored;
close/confirm are accepted only as separate single-key reads, never from the
startup input replay. Selection follows the agent ID;
if it disappears, Enter never silently targets a replacement row. It invokes only bounded `zellij list-panes` / `are-floating-panes-visible` queries
and user-triggered `focus-pane-id`, `close-pane`, and `new-pane` commands;
existing agent registry state is read-only from the panel.
Self-reported identity is not authority; the list/focus race cannot be atomic.

To close an agent's pane, select its row, press `c`, check the pane number in
the prompt, then press Enter or `y` within five seconds (`n` cancels). `Y/n`
marks Yes as the default; Enter accepts it. This is a hard
Zellij pane close, not a graceful Pi shutdown: in-flight work and pane scrollback
may be lost, and children in other panes/processes are not stopped. No keystrokes
are injected into an agent. The action rechecks the selected instance and pane,
same-session/tab, liveness and unique claim; it cannot atomically eliminate a
pane-reuse race. It never bulk-closes, changes registry files, or kills a session.
`q` only closes the Hub view.

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

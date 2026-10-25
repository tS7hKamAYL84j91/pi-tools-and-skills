# pi-cockpit (PoC)

A TUI front-end for one Pi session, built on Pi's RPC protocol instead of the
built-in interactive UI. It runs `pi --mode rpc` as a child process, renders the
streamed conversation and tool activity, and sends prompts, steering, aborts,
and extension-dialog answers back over stdin.

This is a **bounded proof of concept**, not a shipped extension. It has no
deployment, no fleet integration, and no authority over any other extension.

## Why RPC instead of an extension

`ctx.ui.custom()` returns `undefined` in RPC mode and an extension never owns
the terminal in interactive mode, so a redesigned TUI cannot be delivered as a
`pi` extension: whoever owns the screen must own the process boundary. RPC is
the supported contract for exactly that (IDE clients, custom UIs), and it is
versioned and documented. The trade-off is that extension-provided terminal
components degrade to the documented dialog subset below.

**Practical recommendation:** build the cockpit as a standalone RPC client
(this PoC) and treat the built-in TUI as the fallback. Do not attempt to
re-parent Pi's interactive renderer; do not add a terminal plugin API to close
the gap until a real product need survives the PoC.

## Why not the exported `RpcClient`

`RpcClient` is the maintained typed client and was the first choice. Measured
against the installed build (pi-coding-agent 1.0.1):

- `handleLine()` forwards every non-response record to `onEvent`, so
  `extension_ui_request` does reach listeners — but the listener type is
  `JsonAgentSessionEvent`, which does not include that record.
- `send()` is **private** (`dist/modes/rpc/rpc-client.d.ts`), so there is no
  way to write `extension_ui_response` back. Supporting the documented
  dialog sub-protocol is therefore impossible through `RpcClient` alone.
- Malformed stdout lines are swallowed by `handleLine`, so protocol parse
  errors cannot be surfaced to the operator.
- `stop()` sends SIGTERM and has no uncertain-send accounting.

So the cockpit keeps a small typed transport that mirrors the official
`examples/rpc-extension-ui.ts` framing (LF-only splits, `StringDecoder`) and
implements the record shapes from `rpc-types.ts`. **If a future Pi release
exposes a UI-response API on `RpcClient`, switch to it**: delete
`pi-cockpit/rpc-client.ts` and keep the reducer and UI unchanged.

## Reference material

- Official (basis for this PoC): `packages/coding-agent/examples/rpc-extension-ui.ts`
  (lightweight TUI over RPC, `@earendil-works/pi-tui`, streaming plus
  select/confirm/input/editor dialogs), `src/modes/rpc/rpc-client.ts`, and the
  `docs/rpc*.md` protocol pages.
- Architecture reference: `milanglacier/pi-tau-web-server` — standalone Node
  server, N RPC child sessions, reconnect/tab/dialog lifecycle tests.
  **License reference only**: README says MIT but the repository has no LICENSE
  file and the API license is null, so no code is copied.
- Decision-UX reference: `BlackBeltTechnology/pi-agent-dashboard` (MIT verified)
  and `samfoy/pi-dashboard` (MIT verified) — multi-session bridge and dashboard
  UX ideas only; their bundled server/tunnel/auth stack is deliberately not
  adopted.
- `anurag-arjun/pier` (native Go/Gio multi-session client) — **license
  reference only** (no LICENSE file, API license null).

None of the reference projects were installed or run; the comparison is from
source and documentation inspection.

## Run

```bash
COCKPIT_CONFIG=/abs/path/cockpit.json node pi-cockpit/index.ts
# or
node pi-cockpit/index.ts /abs/path/cockpit.json
```

`cockpit.json` is strict JSON; unknown fields fail startup.

```json
{
  "cwd": "/home/jim/git/pi-tools-and-skills",
  "name": "cockpit-poc",
  "provider": "ollama",
  "model": "glm-5.3-flash:cloud",
  "sessionDir": "/tmp/cockpit-sessions",
  "decisionsPath": "docs/decisions.md"
}
```

| Field | Meaning |
|---|---|
| `command` | Child command (default `pi`) |
| `args` | Verbatim child arguments; test/fake-child mode, mutually exclusive with `provider`/`model` |
| `cwd` | Agent working directory (default: cockpit's cwd) |
| `provider`, `model` | Optional provider/model selection |
| `name` | Session display name |
| `sessionDir` | Dedicated session store. **Without it the child runs `--no-session`**, so the PoC never writes into live fleet session directories |
| `decisionsPath` | Read-only decision log for the decisions panel |

No credentials belong in this file.

## Keys

| Key | Action |
|---|---|
| `enter` | Send the prompt; while streaming, queue it as steering |
| `esc` | Clear the queue, then abort the run |
| `ctrl+o` | Toggle the read-only decisions panel (`/` filter, `enter` detail) |
| `pgup` / `pgdn` | Scroll the transcript (tail-following resumes at the bottom) |
| `ctrl+d` | Quit |

## Extension UI support

RPC supports the dialog and fire-and-forget subset of `ctx.ui`. The cockpit
implements all of it and states plainly what it cannot do.

| Call | Cockpit behaviour |
|---|---|
| `select` | Modal chooser; reply `{value}` or `{cancelled:true}` |
| `confirm` | Yes/No chooser; reply `{confirmed}` or `{cancelled:true}` |
| `input` | Single-line entry |
| `editor` | Single-line entry seeded with `prefill` (newlines collapsed) |
| `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text` | Shown as a system note; no reply is sent |
| `custom()`, `onTerminalInput()`, headers/footers/editor components, theme switching | **Unsupported by RPC.** Shown as an explicit "unsupported extension UI request" note, never silently dropped |

## Disconnect and uncertain sends

Control loss and intentional shutdown are different events with different
policy. The transport reports one `DisconnectCause` and a `fault` flag:

| Trigger | Cause | Policy |
|---|---|---|
| child process exited | `exit` | **fault** — disconnect, exit code kept, in-flight ids reported |
| stdout ended without an exit (half-close) | `stdout-closed` | **fault** — sends refused immediately; the cause is reported after a 50 ms grace window so a real exit wins with its code |
| stdin write failed | `write-failed` | **fault** — the child may or may not have acted; never retried |
| child could not start | `spawn-error` | **fault** |
| cockpit quit (`ctrl+d`) | `client-stop` | **not a fault** — intentional shutdown |
| stderr closed or noisy | — | **not a disconnect**: stderr is diagnostics only and never carries protocol records |
| `esc` (abort) | — | **not a disconnect**: cancels the run via `clear_queue` then `abort`; the connection stays up |
| terminal closed / UI detached | — | the cockpit owns its terminal, so this ends the process; there is no headless mode in this PoC |

The header and status line are the source of truth:

- `● connected` — child is alive and the control channel is usable.
- `● disconnected` — a fault or an intentional stop. The status line shows the
  reason; only faults are flagged as errors.
- Any command written but not answered is listed as **effects UNKNOWN** with its
  id. The cockpit never retries it; the operator decides. Commands attempted
  while the control channel is down are refused outright, not buffered —
  including during the short grace window after stdout closes.

Reconnect is deliberate: quit and relaunch. There is no silent re-spawn, no
replay of the last prompt, and no retry of side-effecting commands.

Shutdown is bounded and escalating: close stdin, wait for the exit timeout,
then SIGTERM, then SIGKILL after a short grace. `stop()` resolves only once the
child is gone, so a child that traps SIGTERM cannot hang the cockpit or leave an
orphan behind (covered by a trapping-child fixture).

## Verification

```bash
npx vitest run tests/cockpit/
```

Tests cover strict config parsing and default `--no-session` isolation, JSONL
framing (CRLF, U+2028 inside strings, malformed lines), response correlation,
stderr isolation, disconnect/uncertain-send semantics, streamed-message
reconstruction and authoritative replacement, tool lifecycle, dialog mapping
and reply shapes, decision-log parsing, and width-bounded rendering.

## What this does NOT do

- Ship as a Pi extension, or run inside an existing `pi` session.
- Read other extensions' private state, registries, or session stores.
- Discover sessions or workspaces; everything is configured explicitly.
- Mutate decisions, boards, schedules, models, or permissions.
- Auto-reconnect, auto-retry, or replay side-effecting commands.
- Detach or run headless: quitting ends the child and there is no attach mode.
- Persist drafts or resume a conversation across restarts. `sessionDir` keeps a
  session on disk, but a relaunch starts a fresh child; the PoC does not reattach.
- Support `ctx.ui.custom()` or other terminal-only extension UI (visible above).
- Replace the built-in TUI, or claim production readiness.

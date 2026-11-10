# Pi Subagents Extension

Persistent local RPC workers, extracted from Agent Hub so process management and
peer messaging can evolve independently.

## Enable

From this checkout, `make setup-package PACKAGE=pi-subagents` enables only this
extension. `make setup` enables Agent Hub, Subagents, and Goal together. These
commands change settings only when explicitly run; the split does not migrate
existing settings. Installations filtered to `pi-agent-hub` must also enable
`pi-subagents` to retain the worker tools.

## Tools

| Tool | Purpose |
| --- | --- |
| `spawn_agent` | Start a persistent Pi RPC worker; accepts a plain task or structured brief, optional model/tool restrictions, system prompt, and context capsule. |
| `rpc_send` | Send prompt, steer, follow_up, abort, get_state, get_messages, or compact commands. |
| `list_spawned` | Inspect this session's workers and bounded recent output. |
| `kill_agent` | Stop and remove a worker, gracefully or with an explicit forced kill. |

Tool names and argument schemas remain unchanged. A supplied task/brief starts
work immediately; otherwise the worker stays idle until `rpc_send`. Session
shutdown/reload stops owned children (abort → wait → SIGTERM → wait → SIGKILL).
Unexpected exits without a completion signal produce a recovery follow-up;
deliberate stops do not. Known limitation: completion tracking is keyed by worker
name, so reusing a name after a signalled exit can suppress the replacement's
missing-completion warning. Use a fresh name until this is corrected.

## Messaging is optional

Subagents works without Agent Hub: use `rpc_send` and `list_spawned` for control
and output. It does not register peers, initialize message transports, or expose
`agent_send`, `agent_peek`, or `message_read`.

With Agent Hub enabled in parent and child, workers register there as before.
At spawn time, `lib/agent-identity.ts` reads the parent's session-matched ID and
canonical namespace. It requires a `0700` registry directory and `0600` regular
files, rejects symlinks, and bounds reads to 64 KiB plus one detection byte.
Unsafe records are ignored, not repaired or deleted. Without a matching record,
Subagents uses a session-local parent ID and preserves any valid inherited namespace.

The optional `pi-agent-hub:before-channel-shutdown` event coordinates child
shutdown before Hub drains/closes messaging in either load order. Listeners
synchronously register work with `waitUntil(promise)`; Hub awaits it. Shutdown is
idempotent and removes the listener. No private extension modules or mutable
registry state are shared.

Existing `PI_PANOPTICON_*` keys and child session paths are unchanged. Schedule
scope defaults to `task`; `workspace` opts into schedule delivery, not independent
worker ownership. Both scopes remain children stopped on parent session shutdown.
Child credential stripping remains in `lib/child-env.ts`.

## RPC completion

On Pi 1.0.1, RPC waits for final `agent_settled`, not an intermediate `agent_end`.
Responses are correlated by request ID; rejected or handled prompts return
without waiting for a nonexistent run. Listeners are installed before writing;
deadlines bound every wait.

## Context capsule

`spawn_agent` accepts an optional `capsule`: compressed spawning-session context
(objective, state, decisions, constraints, files). It is appended to the child's
system prompt as labelled background, secret-redacted, and capped at 4,000
characters. It is context, not authority; it cannot grant permissions and may be
stale. `brief.context` remains the task-scoped prose field.

## Output bounds

Recent output retains at most 100 events and 1 MiB of UTF-8 text across stdout,
stderr, stdin errors, and process diagnostics. Individual stderr chunks are capped
at 64 KiB with a truncation marker. Oversized history events leave an omission
marker but are delivered intact to RPC listeners.

Stdout is newline-framed UTF-8. Frames up to 8 MiB are decoded only after their
newline, preserving characters split across chunks. A frame exceeding 8 MiB,
including an unterminated line, terminates that child with SIGKILL and emits a
bounded `process_error`; partial RPC frames are never forwarded. Persisted child
session history is not deleted.

## What this does NOT do

The registered tools, package entrypoint, and documented routing environment are
the public surface; `spawner/` modules are internal. Subagents does not own peer
messaging, the `/agents` overlay, Team Workflows, scheduling, or approvals, and it
does not guarantee worker completion.

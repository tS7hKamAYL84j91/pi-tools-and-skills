# ADR 043: External Agent Mailbox Registration in Panopticon

## Status
Proposed — 2026-08-12

## Context
Pi agents communicate via a local registry (`~/.pi/agents/`) and a Maildir-style inbox under that directory. This works for peer pi sessions, but prevents integration with external, long-running, or non-pi processes that need to exchange messages with pi agents without running the pi runtime themselves.

Working-notes issue #13 requests explicit support for external agents: durable registration, mailbox delivery, and visibility in Panopticon without requiring the external peer to maintain a pi registry heartbeat or process ID.

## Decision
Introduce `kind: "external"` alongside the existing `kind: "pi"` (default) in `AgentRecord`. External agents are registered via a new `external-registrar.ts` module, stored in a durable external-agent manifest outside the volatile registry directory, and delivered to via a persistent mailbox path (conventionally under `/persist`) using the existing `MaildirTransport`.

### 1. `AgentRecord.kind`
- Add optional `kind?: "pi" | "external"` to `AgentRecord` in `lib/agent-registry.ts`.
- Existing records without `kind` are treated as `"pi"` on read.
- `pid` remains required for type compatibility, but external records may set it to `0` or omit it when loaded by the registrar.

### 2. External registrar
Create `extensions/pi-panopticon/registry/external-registrar.ts`:
- `registerExternalAgent(config, { name, mailboxPath })` — create a durable external record with a stable UUID id, write it to `~/.pi/agents/external.json`, and ensure its mailbox directory.
- `loadExternalAgents(config)` — load all external agents from `~/.pi/agents/external.json` at startup.
- `listExternalAgents(config)` — return currently registered external agents.
- `unregisterExternalAgent(config, id)` — remove an external agent from the manifest.

The manifest is a single JSON array, private (`0o600`), versioned (`version: 1`).

### 3. External mailbox path
- External agents carry a durable `mailboxPath` field (absolute path, typically under a host `/persist` directory).
- `lib/transports/maildir.ts` branches on `record.kind`: for `"external"`, it uses `record.mailboxPath` as the inbox base; for `"pi"` (or unset), it uses `REGISTRY_DIR/<id>/inbox` as before.
- `MaildirTransport.cleanup()` is guarded to only delete paths under `REGISTRY_DIR`, protecting persistent external mailboxes.

### 4. Reconciler behavior
- `extensions/pi-panopticon/registry/reconciler.ts` skips PID-alive and stall checks for `kind === "external"`.
- External agents never produce `silent-done` findings.
- Missing heartbeat is interpreted as "sleeping"; status display falls back to `record.status` or `"waiting"`.
- Pending messages still surface as actionable.

### 5. Broadcast and namespace
- External agents participate in `agent_broadcast` by default unless they lack a `mailboxPath`.
- Names are shared across pi and external agents. Registration rejects collisions with existing pi or external names.
- No prefix is added to user-facing names.

### 6. CLI surface
Add Panopticon commands:
- `/agent external register <name> [--mailbox <path>]` — register an external agent; default mailbox path under `~/.pi/persist/external-agents/<name>`.
- `/agent external list` — list external agents and their mailbox paths.
- `/agent external remove <name>` — unregister an external agent.

## Consequences
- External agents appear transparently alongside pi agents in `agent_send`, `agent_broadcast`, `agent_peek`, and `agent_status`.
- The persistence boundary protects external mailboxes from registry wipe (`registry.unregister()` and dead-agent reaping).
- Reusing `MaildirTransport` keeps the message envelope and delivery semantics unchanged.
- The trust model remains producer-side: a pi agent sending to an external peer trusts the recipient to drain its mailbox.

## Risks and mitigations
| Risk | Mitigation |
|------|------------|
| `AgentRecord` shape change breaks existing mocks/tests | `kind` is optional and defaults to `"pi"`; parser accepts absent field |
| `cleanup()` deletes `/persist` mailbox | Guard `cleanup()` to only delete under `REGISTRY_DIR` |
| External agent status becomes stale | No heartbeat for v1; display as "waiting"/"sleeping"; future ADR can add mtime heartbeat |
| Name collisions | Registration rejects collisions; lookup by name returns first match as before |

## Related
- working-notes issue #13
- `lib/agent-registry.ts`, `lib/transports/maildir.ts`
- `extensions/pi-panopticon/registry/registry.ts`, `reconciler.ts`

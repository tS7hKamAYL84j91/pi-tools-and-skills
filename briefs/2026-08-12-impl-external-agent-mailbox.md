# External agent mailbox registration in Panopticon

## Task
Implement working-notes issue #13: allow Panopticon to register/track external (non-pi) agents so `agent_send`, `agent_broadcast`, `agent_peek`, and `message_read` work across process boundaries without requiring the peer to be a pi session.

## Background
The issue was originally resolved for the legacy `tests/messaging.test.ts` fixtures but now requests a runtime feature. This is repo-local `pi-panopticon` implementation, so ownership is `pi-tools-and-skills-gm`.

## Required changes

### 1. `lib/agent-registry.ts`: `AgentRecord.kind`
Add `kind: "pi" | "external"` to `AgentRecord`, default `"pi"`. Existing records without the field are treated as `"pi"` on read for backward compatibility.

### 2. `extensions/pi-panopticon/registry/reconciler.ts`: skip PID checks for external agents
- `confirmedPeerState` for `kind === "external"` should not call `findAgentByName` or rely on PID.
- Missing heartbeat on external records is interpreted as "sleeping", not terminated.
- External agents never produce `silent-done` findings.

### 3. External agent registration
New `extensions/pi-panopticon/registry/external-registrar.ts`:
- `registerExternalAgent(pi, config, record)` — write a durable registry JSON for an external peer.
- `loadExternalAgents(config)` — load external agents from host config at startup.
- `listExternalAgents(config)` — return currently registered external agents.
- Host config path: `~/.pi/agents/external.json` or `~/.pi/agents/external/` directory (decision needed).

External record fields:
- `id`, `name`, `kind: "external"`, `mailboxPath`, `startedAt`, `heartbeat`.
- Optional `status` (default "waiting").
- No `pid`.

### 4. `lib/transports/maildir.ts`: external mailbox resolution
- `inboxPaths` currently hardcodes `REGISTRY_DIR/agentId/inbox`.
- For `kind === "external"` records, resolve inbox from `record.mailboxPath` (under `/persist`) instead of `REGISTRY_DIR`.
- Keep `MaildirTransport` interface unchanged; the transport already takes `AgentRecord` and can branch on `kind`.

### 5. CLI helper
New commands under `/agent external` (or `pi external` if project uses `pi` CLI wrapper):
- `/agent external register <name>` — create external record and mailbox.
- `/agent external list` — list external agents.
- Optional: `/agent external remove <name>`.

### 6. Tests
- External registration writes durable record and mailbox.
- `agent_send` to external peer delivers to external mailbox.
- External reply into pi inbox is readable via `message_read`.
- Reconciler does not flag external agents as terminated when heartbeat is stale.
- Durability across registry wipe: external record survives because it lives under `/persist`.

## Open questions and recommendations

### Q1: Heartbeat for external agents
**Options:**
- A. Touch file mtime on `mailboxPath` as implicit heartbeat.
- B. Explicit heartbeat JSON written by external producer.
- C. No heartbeat; external agents are always considered "sleeping" unless explicit status update.

**Recommendation:** Start with **C** (simplest, no producer-side behavior change). Treat external agents as always available for send; status shown as "waiting" or "sleeping". Later add opt-in mtime heartbeat if needed.

### Q2: Broadcast permission for external agents
**Options:**
- A. Include external agents in `agent_broadcast` by default.
- B. Exclude external agents from broadcast; only direct `agent_send` allowed.
- C. Per-external `broadcast: boolean` flag in registration.

**Recommendation:** Start with **A** for parity with pi peers, but skip external agents that have no `mailboxPath`. This keeps the trust model on the pi producer side (matches constraint "External agent egress is auto-send"). Add opt-out later if needed.

### Q3: Namespace prefix vs shared namespace
**Options:**
- A. Shared namespace (`alice` can be pi or external; last registered wins or errors).
- B. External prefix (`external:alice` auto-prefixed).
- C. Separate registry namespace; lookups merge.

**Recommendation:** **C** with name collision guard. External agents live in the same registry namespace but `registerExternalAgent` rejects a name already taken by a pi agent, and vice versa. The user-facing name stays simple (`alice`).

## ADR need
This is a new persistence boundary (`/persist` external mailbox) and a new cross-process trust model. Per `.pi/settings.json` GM directive, **create ADR-043** before implementation commits land, unless Gravitas/Principal explicitly approves a no-ADR rationale. Since this touches public agent-surface semantics, an ADR is appropriate.

## Acceptance criteria
- [ ] ADR-043 drafted and accepted.
- [ ] `AgentRecord.kind` added, backward-compatible.
- [ ] External registrar module created and unit-tested.
- [ ] Maildir transport resolves external mailboxes.
- [ ] Reconciler skips PID/stall checks for external agents.
- [ ] CLI commands registered.
- [ ] `npm run check` clean.
- [ ] `npm test` 148 passed / 1 skipped + new tests.
- [ ] Architecture tests green.

## Proposed commit plan
1. ADR-043: external agent mailbox boundary.
2. `lib/agent-registry.ts`: add `kind`.
3. `lib/transports/maildir.ts`: external mailbox resolution.
4. `extensions/pi-panopticon/registry/external-registrar.ts` + CLI registration.
5. `extensions/pi-panopticon/registry/reconciler.ts`: external-aware findings.
6. `extensions/pi-panopticon/index.ts`: wire external loading at startup.
7. Tests.

## Risks
- Changing `AgentRecord` affects many modules; keep `kind` optional/defaulted.
- Reusing `MaildirTransport` for external agents requires `cleanup()` to avoid deleting `/persist` mailboxes. Add guard: only cleanup under `REGISTRY_DIR`.
- Registry wipe currently deletes everything in `REGISTRY_DIR`; external records must live outside it.

# Fleet MCP

Standalone MCP gateway for operator-authenticated external principals in one configured workspace, with opt-in access to native Pi agents. It reuses Panopticon's external-agent registrar and the existing Maildir transport; it does not depend on the Pi extension lifecycle.

## Build and run

```bash
npm ci
npm run build:fleet-mcp
FLEET_MCP_CONFIG='{"transport":"http","workspaceAlias":"main","workspaceRoot":"/srv/pi/workspace","mailboxRoot":"/srv/pi/mailboxes","stateDir":"/var/lib/fleet-mcp","listenPort":8787,"bearerToken":"replace-with-secret-reference","principal":"chatgpt-fleet"}' npm run start:fleet-mcp
```

The build emits uniform ESM into ignored `dist/`; the runtime entrypoint is `dist/fleet-mcp/index.js`. Node 22 or newer is required. Protocol output uses stdout only in stdio mode; startup failures use stderr.

## Configuration

`FLEET_MCP_CONFIG` is a strict JSON object. Unknown fields fail startup.

| Field | Required | Contract |
|---|---:|---|
| `transport` | no | `stdio` (default), `http`, or `both` |
| `workspaceAlias` | yes | Alias accepted by every tool; never a filesystem path |
| `workspaceRoot` | yes | Absolute Panopticon workspace path |
| `mailboxRoot` | yes | Absolute persistent external-Maildir root |
| `stateDir` | yes | Absolute private Fleet MCP state path |
| `listenHost` | no | `127.0.0.1`; HTTP refuses any other value |
| `listenPort` | no | `8787` by default |
| `mcpPath` | no | `/mcp` by default |
| `bearerToken` | legacy HTTP | At least 16 characters; provision through the deployment secret boundary |
| `principal` | no | Fixed stdio/legacy HTTP identity (`local-stdio` by default) |
| `httpPrincipals` | mapped HTTP | Nonempty array of `{principal, bearerToken}`; up to 100 unique principals and credentials; mutually exclusive with `bearerToken` |
| `nativeAgentId` | no | Real, live native reference ID granting its existing Panopticon visibility; absent means external-only |
| `limits.pageSize` | no | Default 20, maximum 100 |
| `limits.maxTextBytes` | no | Default 32768 UTF-8 bytes |
| `limits.maxAckIds` | no | Default and maximum 100 |

Mount `workspaceRoot` and `mailboxRoot` according to the existing Panopticon layout. `stateDir` must be writable and persistent; Fleet MCP creates it as `0700` and atomically writes `state.json` as `0600`.

HTTP exposes `POST /mcp`, `GET /healthz`, and `GET /readyz`. `/mcp` requires an exact bearer token comparison. Health and readiness contain no identity, path, or credential details.

## Identity and state

Caller identity never comes from tool arguments. Stdio uses the configured fixed `principal`. HTTP uses either the legacy fixed principal/token or the operator-provisioned `httpPrincipals` credential map. Each HTTP request selects a principal-bound gateway only after authentication; all share one serialized state store. The tools do not accept `client_key` or sender overrides. Provision credentials through the deployment secret boundary, never through tool arguments or shell command lines.

State schema version 2 stores registrations, generation-scoped send receipts and acknowledgement tombstones, unregister tombstones, and broadcast snapshots as entry arrays. Mutations are serialized in-process and persisted atomically. Unversioned and version 1 state are upgraded on the next mutation; unknown or corrupt versions fail closed without rewriting. Run only one gateway process per state directory. Stop the old writer before upgrading; version 2 state is not readable by the old binary, so retain an operator-approved backup before promotion. Deregistration retains mailbox history; re-registering creates a new agent ID and deduplication generation.

## Native interoperability

Native access is **host-first**, using the same user/home/PID namespace as Pi. The registry is `~/.pi/agents`; reading it never reaps agents, changes permissions, or repairs records. `nativeAgentId` must resolve to a valid, live, fresh native record. The existing `canSee(reference, target)` predicate filters native discovery, send and broadcast identically. A global/root requester sees scoped targets too, as in Panopticon today. Missing/stale references fail closed; native session restart requires operator rebinding. The file-backed Panopticon registry is the only native backend.

Native recipients must already have a Maildir inbox. Configure opted-in native Pi sessions with `PI_PANOPTICON_EXTERNAL_WORKSPACE_ROOT` matching Fleet's host `workspaceRoot` and `PI_PANOPTICON_EXTERNAL_MAILBOX_ROOT` matching `mailboxRoot`. Panopticon refreshes that validated source before peer tools resolve names, so registration/removal is visible without restarting sessions. Defaults retain the native session's workspace and standard persistent mailbox root. These settings require operator approval; Fleet never changes them.

Messages retain the legacy sender label and may carry additive `senderId` metadata. Fleet exposes the canonical ID when present; unresolvable legacy native labels have `sender_id: null`. Maildir provenance is still not cryptographic authentication (`authentication_confidence: unknown`).

A container with only external mailbox/workspace mounts is **not native-integrated**. Do not mount a host registry and run foreign-namespace PID checks or claim it ready. Host supervision and later private-ingress/container integration remain separate deployment work.

## Tools

- `fleet_register_external(workspace, display_name)`
- `fleet_agents(workspace)`
- `fleet_send(workspace, recipient_id, text, idempotency_key, correlation_id?)`
- `fleet_broadcast(workspace, text, idempotency_key, filter?)`
- `fleet_inbox(workspace)`
- `fleet_ack(workspace, message_ids)`
- `fleet_status(workspace)`
- `fleet_unregister_external(workspace, agent_id)`

Successful responses place the value under `structuredContent.result` and mirror it as JSON text. Errors expose only stable code, retryability, and an opaque request ID.

Broadcast freezes at most 100 visible recipient IDs, excluding the sender. An optional case-insensitive name substring filters the initial snapshot. Each recipient gets a persisted receipt or failure. Retrying the same key/payload reuses successful receipts, retries remaining targets under current authorization, and never adds newly registered peers. Conflicting payloads fail with `CONFLICT`; results explicitly distinguish `complete` from `partial`.

## Validation

```bash
npx vitest run tests/fleet-mcp*.test.ts
npm run build:fleet-mcp
PI_FLEET_MCP_MCPORTER_SMOKE=1 npx vitest run tests/fleet-mcp-native.test.ts
```

The opt-in check invokes actual `mcporter@0.13.10` over HTTP against disposable registry/Maildir fixtures and native Panopticon tool handlers: registration, discovery, both message directions, inbox/ack, both broadcast directions, and deregistration. It uses a generated credential in the child environment, not argv, and no live registry. It requires `npx`/mcporter availability (or npm access) and is not a production EO/LLM or private-ingress claim.

## Explicit limits

No deployment logic, Tailscale configuration, credential provisioning, cursor pagination, or cross-process state locking. Maildir publication and gateway receipt persistence are not one transaction: a crash between them can duplicate a retried send/broadcast. Registration and acknowledgement have analogous cross-store crash windows. No exactly-once guarantee is made. CoAS owns mounts, secret injection, private ingress, supervision, and approved live smoke tests.

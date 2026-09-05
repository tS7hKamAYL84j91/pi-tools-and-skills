# Fleet MCP

Standalone MCP gateway for one configured principal in one configured workspace. It reuses Panopticon's external-agent registrar and the existing Maildir transport; it does not depend on the Pi extension lifecycle.

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
| `bearerToken` | HTTP only | At least 16 characters; provision through the deployment secret boundary |
| `principal` | no | Fixed authenticated identity (`local-stdio` by default) |
| `limits.pageSize` | no | Default 20, maximum 100 |
| `limits.maxTextBytes` | no | Default 32768 UTF-8 bytes |
| `limits.maxAckIds` | no | Default and maximum 100 |

Mount `workspaceRoot` and `mailboxRoot` according to the existing Panopticon layout. `stateDir` must be writable and persistent; Fleet MCP creates it as `0700` and atomically writes `state.json` as `0600`.

HTTP exposes `POST /mcp`, `GET /healthz`, and `GET /readyz`. `/mcp` requires an exact bearer token comparison. Health and readiness contain no identity, path, or credential details.

## Identity and state

Caller identity never comes from tool arguments. Stdio and HTTP both use the configured fixed `principal`; the HTTP bearer token authenticates that same single principal. The tools therefore do not accept `client_key` or sender overrides.

State schema version 1 stores principal registrations, idempotent send receipts, acknowledgement tombstones, and unregister tombstones as entry arrays (not prototype-sensitive object maps). Mutations are serialized in-process and persisted atomically. Legacy unversioned state from the initial bounded release is read and upgraded on the next mutation; unknown or corrupt versions fail closed without rewriting.

## Tools

- `fleet_register_external(workspace, display_name)`
- `fleet_agents(workspace)`
- `fleet_send(workspace, recipient_id, text, idempotency_key, correlation_id?)`
- `fleet_inbox(workspace)`
- `fleet_ack(workspace, message_ids)`
- `fleet_status(workspace)`
- `fleet_unregister_external(workspace, agent_id)`

Successful responses place the value under `structuredContent.result` and mirror it as JSON text. Errors expose only stable code, retryability, and an opaque request ID.

## Explicit limits

This release deliberately has no daemon backend, deployment logic, Tailscale configuration, credential provisioning, multi-principal HTTP authorization, cursor pagination, or transactional coupling across the Maildir publication/receipt-persistence crash window. CoAS owns container installation, mounts, secret injection, private ingress, supervision, and operational smoke tests.

# Specification 1 — Fleet MCP implementation

Owner: pi-tools-and-skills agent. Status: proposed implementation contract, 2026-09-05.
Companion: coas-fleet-mcp-deployment-spec.md.

## Outcome and ownership

Build a standalone MCP server through which an authorized client can register a durable external-agent identity, discover permitted fleet agents, send a message, and collect and acknowledge replies. The first user journey is: connect, find Gravitas, send a brief, receive a durable transport receipt, later retrieve its reply, and send a follow-up. Use isolated agents for tests.

This owner implements the MCP protocol, fleet adapter, identity and authorization checks, durable messaging semantics, tests, and runnable application release. CoAS owns installation, supervision, runtime configuration, credentials, Tailscale, client connectivity, upgrades, and operational validation. No host-specific networking, systemd installation, or production deployment belongs in this implementation task.

## Repository integration

Repository: https://github.com/tS7hKamAYL84j91/pi-tools-and-skills . Findings informing this design were inspected at revision 99c7a1766482013f91c6c8dabeb323c8977f0888; recheck relevant interfaces before coding. Live Spark runtime has not been inspected by this specification's author.

Read current AGENTS.md and its referenced state document; use the existing Kanban workflow and required architecture review. Update relevant ADR/C4 documentation. Preserve ownership boundaries: Panopticon owns registry and messaging; pi-teams owns its public team interface. Do not couple the server to private UI or spawner internals.

Reuse the external registrar in extensions/pi-panopticon/registry/external-registrar.ts and Maildir transport in lib/transports/maildir.ts where the selected runtime supports them. Existing external IDs, manifests, locks, path confinement, atomic writes, and mailbox retention are constraints to preserve. Current registration collision handling needs an explicit idempotent ownership layer. Existing display-name/from labels are not authenticated principals.

Choose one supported fleet backend per configured workspace. Obtain CoAS's runtime inventory before choosing the production backend. If daemon mode is active, use an authenticated supported daemon API for required operations; the inspected registry socket alone does not establish a general messaging API. Add a reviewed supported interface if necessary. Do not combine daemon discovery with direct Maildir writes that bypass daemon policy, queue signing, generation checks, or deduplication. Backend loss must not silently switch authority.

Expose a narrow FleetGateway abstraction for registry, registration, send, inbox, acknowledgement, and health. Keep MCP independent of the Pi extension lifecycle. Ensure new external registrations become visible to already-running Pi sessions through a supported refresh mechanism.

## Protocol and tool contract

Use the official TypeScript MCP SDK with a pinned supported version. Support stdio for local clients and Streamable HTTP at /mcp for remote deployment. Default HTTP binding is 127.0.0.1; CoAS provides private Tailscale HTTPS and SSH access from the user's current machine. SSH bridges/forwarders connect to the single running HTTP service; they must not launch competing writers against its state. Negotiate supported MCP versions; publish input/output JSON schemas and accurate tool annotations. Send protocol data only to stdout in stdio mode; logs go to stderr.

Every tool takes a configured workspace alias, never an arbitrary filesystem path. Caller identity comes from authentication, never from tool arguments. Unknown properties and oversized requests are rejected. Return structuredContent and a compatible text representation.

| Tool | Additional inputs | Required behavior | Scope |
|---|---|---|---|
| fleet_register_external | client_key, display_name | Return owned stable agent_id; repeat same registration safely; reject conflicting ownership/configuration | fleet:admin |
| fleet_agents | query?, cursor?, limit? | List visible agents with ID, name, kind, status, observed_at, and liveness confidence | fleet:read |
| fleet_send | recipient_id, text, idempotency_key, correlation_id? | Return durable receipt: message_id, accepted_at, state, correlation_id | fleet:send |
| fleet_inbox | cursor?, limit?, correlation_id? | Read this principal's configured external inbox without consuming messages | fleet:inbox |
| fleet_ack | message_ids[] | Acknowledge owned messages with a result for each ID; repeated acknowledgement succeeds | fleet:inbox |
| fleet_status | none | Report backend connectivity, observation freshness, own identity, pending count, and allowed aggregates | fleet:read |
| fleet_unregister_external | agent_id | Remove owned registration metadata; retain mailbox/history; repeated removal is safe | fleet:admin |

Use default page size 20, maximum 100, text limit 32 KiB UTF-8, and maximum 100 acknowledgement IDs. Define a bounded response-size policy that never silently skips messages; oversized legacy messages return explicit truncation metadata and remain unacknowledged. Cursors are opaque and bound to principal, workspace, and filter. Concurrent arrivals must not make pagination skip previously unread messages.

Each inbox item includes message_id, sender agent ID where known, sender label, text, timestamp, optional correlation_id/in_reply_to, and provenance/authentication confidence. Labels from legacy envelopes must not be represented as authenticated identities.

Tool failures use MCP error results with stable application codes: INVALID_ARGUMENT, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, BACKEND_UNAVAILABLE, RATE_LIMITED, and INTERNAL. Include retryable and an opaque request_id. Do not leak hidden-agent existence, paths, tokens, or stack traces. HTTP authentication failures use the applicable MCP authorization response rather than a successful tool response.

## Identity and access

Persist the mapping (authenticated principal, workspace, configured client_key) → external agent ID. Logical identity survives reconnects and process restarts. Only provisioned client keys are allowed; clients cannot claim identities by choosing display names. Unregister must revoke active use of the removed identity until explicit registration succeeds again.

One configured chatgpt-fleet identity can serve a user's conversations. Conversation isolation requires separately provisioned client keys; do not assume ChatGPT supplies a stable conversation identifier. No tool accepts a sender override, PID, mailbox path, credential, or host command.

Enforce workspace membership, registry visibility rules, tool scopes, and external identity ownership on each request. Revalidate send permission against current recipient identity/generation; stale or ambiguous targets fail explicitly. A tailnet connection or MCP session identifier alone is not application authorization.

Implement HTTP bearer-token validation with configured issuer, audience/resource, expiry, and scopes plus required MCP authorization metadata. CoAS provisions the authorization provider, clients, resource URLs, and secrets. Do not build an authorization server as part of v1. Reject untrusted identity headers. A trusted proxy authentication mode, if needed, requires an explicitly documented local trust boundary and protection against header spoofing or bypass. For stdio, use an explicit fixed local principal and allowed scopes.

## Durability and semantics

1. A successful send means durable transport acceptance, not recipient execution or task completion. The call returns promptly after persistence and never waits for the agent to finish.
2. Persist idempotency across restart, scoped by principal/workspace/key. Identical retries return the original receipt; a changed payload or recipient with the same key returns CONFLICT. Document retention and reject expired retained keys where detectable; do not promise deduplication beyond the published retention window.
3. Handle a crash between publication and receipt persistence through a recoverable journal/deterministic message identity or the backend's equivalent transactional operation. Demonstrate recovery without duplicate publication. Do not promise exactly-once agent execution.
4. Reading does not acknowledge. Ack means consumed by this client, not task completion. Make acknowledgement durable and safe across concurrent readers and restart; keep suitable tombstones for repeat requests.
5. Add optional correlation_id and in_reply_to backward-compatibly throughout supported message readers/writers. Legacy uncorrelated replies remain readable and are not falsely matched to a task.
6. Registration is not proof of liveness. Report stale/unknown state honestly; do not imply that sending wakes stopped agents. Completion states must come from explicit attributed agent replies, never inferred from an accepted receipt.
7. Preserve unread messages on restart, unregister, upgrade, and retention maintenance. Prevent symlink/path traversal and never interpret message text as server instructions.

## Application handoff contract with CoAS

Deliver a runnable standalone entrypoint, locked dependencies, build command, supported runtime/OS/architecture matrix, license/dependency inventory, and release version/source revision. CoAS builds or consumes a pinned artifact; it must not patch message semantics to deploy it.

Publish a versioned config schema and validated example containing: transport, listen address/port, /mcp path, allowed external origins/resource URLs, authentication provider settings, principal/client/workspace mappings, backend selection and socket or mailbox paths, persistent state directory, limits, and retention. Paths and secret references are provisioned by CoAS. Defaults must not grant fleet-wide access.

Provide configuration validation without mutations, version reporting, and documented state-schema versions/migration commands. Refuse incompatible state without changing it. Separate immutable application files from persistent identity mappings, dedupe journal, acknowledgement state, and fleet-owned mailboxes. Document every writable path and migration's rollback compatibility.

Expose loopback operational endpoints /healthz (process alive) and /readyz (valid config, writable state, selected backend usable), with minimal details and correct failure codes. CoAS should keep these private. fleet_status may report degraded state when authenticated MCP reads remain possible. On SIGTERM, stop accepting new work, finish or recover durable writes, and close within a configurable grace period.

Structured logs include request ID, operation, safe identity IDs, backend, result, and duration; exclude tokens and message bodies by default. Include startup/readiness failure reasons suitable for deployment diagnosis. Coordinate proxy origin handling, authorization discovery URLs, streaming headers/timeouts, and private HTTPS/SSH-forwarded resource audiences with CoAS; do not assume proxy Host headers are trustworthy.

## Acceptance and delivery

Pass repository-required npm run check and npm test plus focused contract tests for both transports. Demonstrate the complete register → discover → send → reply → read → ack sequence with an isolated agent. Test reconnect/restart persistence, crash-window send recovery, duplicate/conflicting requests, concurrent inbox reads/acks, hidden workspace/recipient access, spoofed identities, stale recipient IDs, registration refresh, backend outage, and mailbox retention after unregister.

Deliver code, tests, architecture updates, config/schema reference, tool examples with expected outputs, migration/recovery notes, and the runnable release contract. CoAS accepts this handoff when it can start the server and run the smoke test using documented configuration without editing implementation files.

Excluded from v1: arbitrary shell/SSH tools, spawn/kill, scheduling, autonomous inbox polling, fleet broadcasts, Teams orchestration, and automatic waking of closed ChatGPT conversations.

## References

- Repository and current instructions: https://github.com/tS7hKamAYL84j91/pi-tools-and-skills
- MCP transport specification: https://modelcontextprotocol.io/specification/latest/basic/transports
- MCP authorization specification: https://modelcontextprotocol.io/specification/latest/basic/authorization
- Companion deployment specification defines target-host and Tailscale acceptance.

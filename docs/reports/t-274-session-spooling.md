# T-274 Claude Code Session Spooling POC

Date: 2026-05-22

## Summary

This POC bridges session entries into a Panopticon-compatible fixture record: a registry JSON file plus a pi-compatible session JSONL file that existing `agent_peek` parsing can read through `readSessionLog`.

Posture update from T-489: local private pi harness/session logs are trusted personal input and may remain unredacted inside local-only harness/code-hook paths. Redaction is still required at artifact/share boundaries: committed fixtures, pushed docs, cross-agent exposure, external providers, or any exported/shared journal.

Artifacts:

- `lib/session-spool.ts` — off-by-default spooling helper.
- `tests/session-spool.test.ts` — synthetic fixture tests for compatibility and safety.
- Related boundary from T-485: `lib/session-journal.ts`.

## Compatibility boundary

Panopticon `agent_peek` reads an `AgentRecord.sessionFile` via `lib/session-log.ts`. The POC writes:

- `<registryDir>/<agentId>.json` with an `AgentRecord` shape.
- `<registryDir>/<agentId>/session.jsonl` with pi-compatible message blocks:
  - text timeline entries for message/session/custom/model events;
  - `toolCall` blocks for tool calls;
  - `toolResult` blocks for tool results.

This validates the adapter boundary without requiring a pi RPC socket.

## Opt-in/use

Programmatic use only for now. For committed tests/docs, use synthetic or redacted entries. For a private local harness path, the caller may pass parsed local pi session entries directly, but must keep output local and must not commit/push/share those outputs without redaction approval:

```ts
await spoolSessionEntries({
  enabled: true,
  registryDir,
  agentId: "claude-code-demo",
  name: "Claude Code Demo",
  cwd,
  entries: localPrivateOrSyntheticEntries,
});
```

Disable/uninstall path: do not call the helper, or call it with `enabled: false`; remove the fixture registry directory/files created by the caller. No hook is installed by this POC.

## Safety and retention

- Off by default; no runtime hook installation.
- Does not read live Claude Code or pi session logs itself; callers supply parsed entries.
- Local private pi harness inputs may be unredacted while they remain local/private.
- Committed fixtures, pushed docs, cross-agent IPC, external-provider calls, and shared/exported artifacts must use synthetic/redacted data or explicit approval.
- The current helper still reuses T-485 journal redaction before writing its Panopticon-compatible output, because that output can be observed by `agent_peek`/Panopticon peers in the selected registry directory. A future strictly single-process private hook may choose an unredacted local output mode only with an explicit boundary and ADR.
- Event allow-list defaults to known journal event types; callers may narrow it.
- Retention is bounded with `maxEvents` and hard-capped at 100 spooled events.
- Registry visibility is `scoped`; model label is `claude-code/session-spool` to make fixture origin visible.

## Intentionally not enabled

- No default hook installation.
- No broad ingestion of real private logs.
- No committing, pushing, or sharing unredacted logs.
- No cross-agent exposure beyond whatever registry directory the caller explicitly chooses; exposing unredacted private logs cross-agent requires explicit approval.
- No persistent DB, long-term retention store, or role-memory feed.

## Relation to Scenius / T-485

T-485 defines safe session-to-journal extraction for durable/shareable artifacts. T-274 adds the next local observability step: writing activity into a shape Panopticon already understands. T-489 clarifies that local private pi harness logs do not need pre-redaction merely to be used as local input; redaction applies at output/share/cross-agent boundaries. The recommended next step remains a separate read-only episodic store before any role-memory adoption.

## ADR disposition

`adr_deferred_rationale`: ADR is deferred because this is an off-by-default POC helper and fixture-compatible adapter, not an adopted durable Claude Code/pi harness hook or export boundary. ADR becomes required before any default hook, real Claude Code/pi hook install, unredacted output mode, persistent retention policy, cross-agent exposure, external-provider export, or runtime memory/retrieval integration.

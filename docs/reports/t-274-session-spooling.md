# T-274 Claude Code Session Spooling POC

Date: 2026-05-22

## Summary

This POC bridges approved synthetic/redacted Claude Code-style session entries into a Panopticon-compatible fixture record: a registry JSON file plus a pi-compatible session JSONL file that existing `agent_peek` parsing can read through `readSessionLog`.

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

Programmatic use only for now:

```ts
await spoolSessionEntries({
  enabled: true,
  registryDir,
  agentId: "claude-code-demo",
  name: "Claude Code Demo",
  cwd,
  entries: syntheticOrRedactedEntries,
});
```

Disable/uninstall path: do not call the helper, or call it with `enabled: false`; remove the fixture registry directory/files created by the caller. No hook is installed by this POC.

## Safety and retention

- Off by default; no runtime hook installation.
- Does not read live Claude Code or pi session logs.
- Uses synthetic/redacted parsed entries supplied by the caller.
- Reuses T-485 journal redaction for secrets, raw/private/reasoning-like fields, nested payload omission, and missing-field tolerance.
- Event allow-list defaults to known journal event types; callers may narrow it.
- Retention is bounded with `maxEvents` and hard-capped at 100 spooled events.
- Registry visibility is `scoped`; model label is `claude-code/session-spool` to make fixture origin visible.

## Intentionally not enabled

- No default hook installation.
- No broad ingestion of real private logs.
- No cross-agent exposure beyond whatever registry directory the caller explicitly chooses.
- No persistent DB, long-term retention store, or role-memory feed.

## Relation to Scenius / T-485

T-485 defines safe session-to-journal extraction. T-274 adds the next local observability step: writing redacted activity into a shape Panopticon already understands. The recommended next step remains a separate read-only episodic store before any role-memory adoption.

## ADR disposition

`adr_deferred_rationale`: ADR is deferred because this is an off-by-default POC helper and fixture-compatible adapter, not an adopted durable Claude Code hook/export boundary. ADR becomes required before any default hook, real Claude Code hook install, persistent retention policy, cross-agent exposure, or runtime memory/retrieval integration.

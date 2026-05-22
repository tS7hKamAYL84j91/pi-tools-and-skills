# T-485 Session Journal Boundary POC

Date: 2026-05-22

## Summary

This POC defines a minimal read-only boundary for converting pi session export entries into compact episodic Markdown journals. It does **not** ingest live private session logs and does **not** introduce runtime memory.

T-489 posture update: local private pi harness/session logs are trusted personal input and may remain unredacted for local-only harness/code-hook use. Redaction remains mandatory for committed fixtures, pushed docs, cross-agent IPC, external providers, shared remotes, and durable exported artifacts unless explicitly approved.

Artifacts:

- `lib/session-journal.ts` — pure conversion/redaction utility.
- `tests/session-journal.test.ts` — fixture-backed tests using inline synthetic entries only.

## Boundary

Input is an array of parsed session-export entries shaped like pi session JSONL records, not a file path and not a live session reader. Supported public event families:

- `message.content[]` text blocks.
- `toolCall` / `tool_use` blocks with summarized inputs.
- `toolResult` / `tool_result` blocks with omitted full array payloads.
- `session`, `model_change`, and `custom` top-level records.

Unknown records are represented as omitted timeline entries. Missing fields are tolerated.

## Safety rules

- No live private logs are read by this POC.
- Local private harness input may be unredacted before this artifact boundary.
- Raw message payloads and full tool dumps are not preserved in generated journal artifacts.
- Private/reasoning-like keys are omitted: `reasoning`, `thinking`, `chain_of_thought`, `hidden`, `private`, `raw`, `rawMessage`, `rawPayload`.
- Common secret patterns are redacted in strings: token/password/api-key assignments, GitHub tokens, `sk_`/`pk_` style keys, and email addresses.
- Text summaries are bounded to 240 characters.

## Next decision

Recommended next step: keep journals in a separate read-only episodic store first. Do not feed them into role memory until a later decision validates retrieval, retention, deletion, and user-visible controls. If adopted later, role memory should consume only approved local-private or redacted journal summaries according to the chosen boundary; raw session exports must not be committed, pushed, shared, or sent to external providers without approval.

## Internal adapter contract tests

T-500 added internal guardrail tests for the current session-entry -> journal ->
Panopticon-compatible spool adapters. These tests pin redaction, bounded summaries,
and local claim-check metadata handling before any future promotion. They are not
a public schema commitment and do not enable hooks, external export, or memory
retrieval.

## ADR disposition

`adr_deferred_rationale`: ADR is deferred because this is a non-runtime POC utility and report, not an adopted durable pi session export boundary. ADR becomes required when a tool/command/lifecycle hook reads real session files, persists journal artifacts, exposes unredacted logs beyond a local private harness, or feeds journals into memory/retrieval.

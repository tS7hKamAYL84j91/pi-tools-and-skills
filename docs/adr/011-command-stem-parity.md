# ADR 011: Command/Tool Stem Parity

## Status

Accepted

## Context

Command and tool names were forced toward one-to-one parity (e.g. `/teams` +
`team_*`), creating awkward proliferation when a slash command and tool serve
different audiences.

## Decision

Allow patterns like `/kanban` + `kanban_*` and `/teams` + `team_*`.
Require descriptions to state whether a slash command is a human UI command, a
model-facing tool equivalent, or both.

## Consequences

- Avoids awkward command proliferation.
- Keeps discovery predictable through clear descriptions.
- Commands with shared prefixes must have predictable exact-match behavior
  (see ADR 009).

## Related

- ADR 009 (reserved command names).

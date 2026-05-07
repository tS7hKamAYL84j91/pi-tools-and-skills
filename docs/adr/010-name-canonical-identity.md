# ADR 010: `/name` as Canonical Human Identity Command

## Status

Accepted

## Context

pi-tools previously had both `/name` and `/alias` slash commands for setting
the agent/session display name. This created a split in the human-facing
identity surface.

## Decision

Remove the pi-tools `/alias` slash command. Panopticon derives the registry
name from pi's session name via heartbeat-time reconciliation. Built-in `/name
<name>` becomes the single human-facing command for naming the current
agent/session.

## Consequences

- Eliminates the `/name` vs `/alias` split.
- Deliberate compatibility break for `/alias`; accepted because it duplicates a
  built-in concept.
- Model-facing naming still needs a programmatic tool — see ADR 012.

## Related

- ADR 009 (reserved names).
- ADR 012 (programmatic naming tool).

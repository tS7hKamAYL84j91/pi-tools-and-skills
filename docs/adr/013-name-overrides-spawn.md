# ADR 013: `/name` Overrides Spawn Name with Metadata Preservation

## Status

Accepted

## Context

When a user sets identity via `/name` or `set_name`, there was ambiguity about
whether the original spawn name should be preserved or overwritten.

## Decision

- The new name becomes the active display and registry name.
- The original spawn name is preserved as immutable `spawn_name` metadata.
- Orchestration routes by stable agent/session IDs or by `spawn_name`/`role`,
  never by mutable display name.

## Consequences

- Eliminates split-brain identity where the UI says one name and the registry
  another.
- Spawn identity is not lost — it moves to a metadata field.
- Makes `/name` the single source of truth for current identity.

## Related

- ADR 010 (`/name` canonical identity).
- ADR 012 (programmatic naming tool).

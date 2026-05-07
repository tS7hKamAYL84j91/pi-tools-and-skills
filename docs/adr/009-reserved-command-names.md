# ADR 009: Reserved Command Names

## Status

Accepted

## Context

pi-tools extension and prompt commands could collide with built-in pi commands,
causing autocomplete filtering/suffix surprises.

## Decision

pi-tools extension and prompt commands must not use exact built-in pi command
names. Commands are checked against a built-in inventory list during slash-command
registration (`tools/update.ts`).

## Consequences

- Prevents autocomplete filtering/suffix surprises.
- Keeps built-in mental models intact.
- Commands with shared prefixes (e.g. `/agent`, `/agents`) are permitted; exact
  match takes precedence.

## Related

- `docs/adr/011-command-stem-parity.md`

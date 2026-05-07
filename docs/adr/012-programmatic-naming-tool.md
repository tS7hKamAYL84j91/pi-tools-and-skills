# ADR 012: Programmatic Naming Tool Replaces `set_alias`

## Status

Accepted

## Context

`/alias` was removed (ADR 010) but models and RPC callers still need a way to
set agent identity programmatically. `set_alias` was the existing tool but its
terminology no longer aligns with the canonical `/name`.

## Decision

- Add `set_name` as the canonical programmatic naming tool and replacement for
  `set_alias`.
- Add `get_name` as the replacement for `get_alias`, reporting session name,
  registry name, and spawn-name metadata.
- After the two-release deprecation window, remove the deprecated `set_alias`
  and `get_alias` compatibility wrappers.

## Consequences

- Models and RPC callers retain programmatic naming capability.
- Terminology aligns with built-in `/name`.
- The completed deprecation window avoided immediate hard breakage for existing
  callers while giving them time to migrate.
- `set_name` may dual-write (set session name + update registry directly) when
  immediate consistency is needed before heartbeat fires.

## Related

- ADR 010 (`/name` as canonical identity).
- ADRS 009 (reserved command names).

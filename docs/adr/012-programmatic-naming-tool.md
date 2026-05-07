# ADR 012: Programmatic Naming Tool Replaces `set_alias`

## Status

Accepted

## Context

`/alias` was removed (ADR 010) but models and RPC callers still need a way to
set agent identity programmatically. `set_alias` was the existing tool but its
terminology no longer aligns with the canonical `/name`.

## Decision

- Add `set_name` as the canonical programmatic naming tool.
- `set_alias` becomes a deprecated compatibility wrapper that forwards to
  `set_name`.
- `get_alias` becomes `get_name`, reporting both session name and registry name.
- Deprecation window: two releases / sprints, then `set_alias` is removed.

## Consequences

- Models and RPC callers retain programmatic naming capability.
- Terminology aligns with built-in `/name`.
- The deprecation window prevents hard breakage for existing callers.
- During transition, `set_name` / `set_alias` may dual-write (set session name +
  update registry directly) if immediate consistency is needed before heartbeat
  fires.

## Related

- ADR 010 (`/name` as canonical identity).
- ADRS 009 (reserved command names).

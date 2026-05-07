# ADR 008: Browser Toggle Search Mode

## Status

Accepted

## Context

`team-picker.ts` and `team-models.ts` use `Input` + `SelectList` for
searchable pickers. The team browser overlay combines browse, select, and
actions in one view, so converting it entirely to `SelectList` would lose
action affordances (`f` form, `m` models, `d` delete).

## Decision

Add a `/` key to toggle a search/filter mode inside the browser overlay.

- **Search mode**: `Input` component appears; typing filters teams via
  `fuzzyFilter` on `id/name/protocol/source/description`. `↑/↓` navigates
  filtered list, `enter` opens detail, `esc` clears filter and exits search.
- **Browse mode**: All original keybindings (`↑/↓`, `enter`, `f`, `m`, `d`)
  preserved. `/` enters search mode.
- **Empty match**: "No matching teams."
- **Detail/delete flows**: Unaffected by search state (detail from search resets
  to filter list on `backspace`; delete only triggers in browse mode).

## Consequences

- Backward-compatible — browse mode behavior unchanged.
- Search mode gives fuzzy filtering without conflicting with action keys
  (`f`/`m`/`d` only work outside search).
- Uses `Input` and `fuzzyFilter` from pi-tui; no new UI framework.
- `Input` component implements `Focusable` so IME cursor placement works.

## References

- Extracted from `docs/teams-ux-improvements.md` ADR-002 (2026-05-04).
- `skills/tui-design/SKILL.md` — keyboard-only operation, search affordances.

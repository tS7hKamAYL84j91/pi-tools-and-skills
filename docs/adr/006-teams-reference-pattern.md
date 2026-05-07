# ADR 006: Teams as the Reference TUI Pattern

## Status

Accepted

## Context

Teams has the most complete alignment with the TUI design guidance and pi
component philosophy: composable pi-tui components, explicit keyboard hints,
`/` search, `>` marker, and no layout-critical emoji.

## Decision

New or updated extension overlays should first consider the Teams pattern:
- Composable pi-tui components (`Container`, `Text`, `Input`, `SelectList`,
  `DynamicBorder`, theme-aware rendering)
- Explicit keyboard-only operation with `esc` close/cancel
- `/` toggles search/filter mode where list density warrants it
- `>` selected-row marker (ASCII, non-color dependent)
- No layout-critical emoji or raw ANSI in render paths
- Width-bounded rendering with intentional truncation at narrow widths

## Consequences

- Reduces one-off rendering drift without requiring a broad framework replacement.
- Establishes a concrete precedent when reviewing new overlay PRs.
- Keeps each extension as an isolated vertical slice; no shared UI framework
  introduced.

## Related

- ADR 005 (selection marker standardization).
- Canonical TUI guidance: `skills/tui-design/SKILL.md`.

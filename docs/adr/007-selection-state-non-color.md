# ADR 007: Selection State Must Not Rely on Color Alone

## Status

Accepted (amended after co-pilot review)

## Context

Terminal color palettes vary by theme, terminal, SSH/tmux mediation, and
screenshot tooling. The teams UI uses accent color heavily for selected rows.

## Decision

Standardize on `>` as the non-color selection marker across all pi-teams
overlays:

- **Browser**: `>` prefix rendered as plain text before accent-colored bold
  content.
- **Pickers** (model picker, target picker): `selectedText` replaces pi-tui's
  hardcoded `→` with `>` via `text.replace(/^→/, ">")`.
- **Additional cue**: Browser selected row uses `theme.bold()` on content for
  non-color visibility.

## Consequences

- `>` is visible in plain text captures and ASCII-safe.
- Bold styling degrades gracefully in terminals without bold support.
- The `selectedText` workaround can be removed if pi-tui exposes a
  configurable prefix.
- `selectedPrefix` remains in `SelectListTheme` interface (required by type),
  but is documented as ignored at runtime; no code change possible without a
  pi-tui update.

## References

- Extracted from `docs/teams-ux-improvements.md` ADR-001 (2026-05-04).
- `skills/tui-design/SKILL.md` — color-independent state markers.

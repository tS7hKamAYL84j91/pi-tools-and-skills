# ADR 005: Shared Selection Marker `>`

## Status

Accepted

## Context

Teams already standardized on `>` and `termwright` captures show it survives
plain-text capture. Kanban and Panopticon still use different markers (`▶`, `→`).

## Decision

Adopt `>` as the selected-row marker for all extension overlays and pickers.
Use color and bold only as secondary affordances.

| Surface | Before | After |
|---------|--------|-------|
| Teams browser | `>` (kept) | `>` |
| Kanban board | `▶` | `>` |
| Kanban modal | `→` | `>` |
| Panopticon overlay | `→` | `>` |
| Panopticon list-mode | `→` | `>` |

In picker overlays (model picker, target picker, Panopticon `SelectList`), the
`selectedText` theme function post-processes pi-tui's hardcoded `→` prefix,
replacing it with `>` via `text.replace(/^→/, ">")`. Bold styling is added to
the browser's selected row content for an additional non-color cue.

## Consequences

- Improves plain-text readability and cross-extension consistency.
- `>` is visible in plain text captures, is ASCII-safe for OCR, and is
  consistent with pi's own `config-selector`.
- Slightly reduces horizontal space (2 chars prefix).
- The `selectedText` post-processing is a lightweight workaround; if pi-tui
  makes the prefix configurable, the `replace` can be removed.
- Bold on selected content is an additional non-color affordance that degrades
  gracefully in terminals that don't support bold.

## References

- Extracted from `docs/tui-ux-update.md` ADR-001 (2026-05-04).
- `skills/tui-design/SKILL.md` — non-color markers guideline.

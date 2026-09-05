# T-896 Priority Ordering

## Target

Make display-only Kanban ordering deterministic in the overlay and Markdown snapshot views. Non-Done columns (`backlog`, `todo`, `in-progress`, `blocked`) sort by `critical → high → medium → low`; ties retain `BoardState.order` (canonical board order). Done keeps its existing recency behavior: board order is preserved for history selection, then the recent bounded slice is reversed for newest-first display. No event, priority schema, claim, WIP, rank, config, or persistence changes.

Priority compatibility is deliberately deterministic: canonical lower-case values use the four ranks; legacy case variants are normalized case-insensitively; missing, empty, and unknown values sort after `low` and retain canonical order among themselves. Unknown values remain unchanged in task data and are not displayed as a new rank.

The overlay header will show a fixed, non-interactive `priority ↓` indicator so the active-column sort is visible. Snapshot summaries and full snapshots will use the same active-column ordering and document the indicator/compatibility rule. Selection and scrolling remain task-ID stable across live rebuilds and priority changes.

## Acceptance

- Active overlay and snapshot columns agree on priority ordering and canonical-order ties.
- Done recency/window and newest-first presentation remain unchanged.
- Missing, legacy/case-variant, and unknown priorities have documented deterministic fallback behavior.
- Fixed sort indicator is visible without adding controls or changing schemas.
- Filtered views, watcher/live refresh, selected task identity, and scroll position remain stable by task ID.
- Focused regression tests cover ordering, ties/fallbacks, Done behavior, summaries, and selection identity; existing checks remain clean.

## Footprint

- `extensions/pi-kanban/overlay-model.ts`: shared display ordering and selection-stable view projection.
- `extensions/pi-kanban/overlay.ts`: preserve selected task ID/scroll anchor during live rebuilds.
- `extensions/pi-kanban/overlay-render.ts`: fixed sort indicator.
- `extensions/pi-kanban/snapshot-model.ts` and `snapshot.ts`: shared ordering for summaries/full snapshots and documentation text.
- `extensions/pi-kanban/README.md`: display ordering contract.
- `tests/kanban/`: focused regressions for overlay/snapshot projection and live identity behavior.
- `docs/architecture.md`: only if the existing Kanban model needs a narrowly relevant display-order note.
- `docs/reports/t-896-implementation.md`: implementation and verification evidence.

## Review plan

Run focused Kanban tests first, then `npm run check` and `npm test` without installing dependencies or running broad formatters. Inspect the diff for scope, schema/persistence invariants, Done recency, and identity preservation. Stop for independent review; do not commit, push, merge, or mutate Kanban board state.

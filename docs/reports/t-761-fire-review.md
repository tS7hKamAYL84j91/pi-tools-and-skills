# T-761 FIRE Review — CoAS Workspace and Compact Kanban TUI

Date: 2026-08-19
Status: complete
Verdict: PASS (review scope); current unrelated T-822 work is blocked separately.

## Scope

Review material pi-tools changes after the prior FIRE reviews, focused on:

- CoAS workspace context source, confined path resolution, and gradual disclosure.
- Compact Kanban widget/footer lineage (`c3aea57`, `ab7d78e`).
- Extension boundaries, public workspace-tool behaviour, and focused test stability.

Excluded: uncommitted approval-inbox TUI work (T-822), the missing T-834 delegated artifact, raw sessions, private runtime data, credentials, and unrelated extensions.

## Evidence

- `extensions/pi-coas/workspace-context.ts`, `workspace-paths.ts`, `store.ts`, and `tools-workspace.ts`.
- `extensions/pi-kanban/overlay.ts` and `overlay-render.ts`.
- `c3aea57` (compact Kanban widget and fitness remediation) and `ab7d78e` (compact footer counts).
- `npm test -- tests/kanban/pi-kanban-overlay-render.test.ts tests/kanban/pi-kanban-tools-snapshot-overlay.test.ts tests/coas/pi-coas-unit.test.ts tests/coas/pi-coas-consumer-symlink.test.ts` — PASS: 4 files, 89 tests.
- `git diff --check` — PASS.
- Bounded key-pattern filename scan over reviewed extension/shared-library sources — 0 matches.

## FIRE / architecture assessment

| Lens | Result | Evidence |
|---|---|---|
| Fast | PASS | Focused workspace, confinement, and Kanban rendering tests complete in under one second. |
| Inexpensive | PASS | Reviewed paths use native filesystem/TUI utilities; no dependency or service addition. |
| Restrained | PASS | Context reads default to a 12 KiB prefix; full/section reads are explicitly size-guarded. The Kanban renderer is pure, while the overlay retains mutation/watcher state. |
| Elegant | PASS | `ConfinedStore` owns path and symlink enforcement; workspace tools adapt that API without reimplementing I/O policy. The compact widget retains the full board as a separate overlay. |

## Findings

1. **Gradual disclosure and confinement are coherent.** Summary reads do not load the full context, section/full reads have explicit 128 KiB guards, and managed/external workspace stores both enforce their capability root and symlink checks.
2. **Public behaviour is minimal and clear.** Workspace tools expose explicit `summary`, `section`, and `full` modes; create remains independent of Matrix room creation.
3. **Kanban UI boundaries remain compact.** `overlay-render.ts` is side-effect-free; `overlay.ts` owns keyboard state, watcher lifecycle, and board mutations. The widget/footer lineage presents counts while retaining the richer board on demand.
4. **Minor style follow-up.** `renderMovePicker` has two statements on one line in `overlay-render.ts`. This is not a behavioural or architectural defect; format it with the next scoped Kanban edit.

## Current-work caveat

`npm run typecheck` is currently blocked by uncommitted T-822 test code, not by the reviewed T-761 paths. The new approval-inbox overlay test imports a non-exported `showAgentDetail` and its test harness has several type errors. Its focused Vitest run also fails 7 of 8 tests. This is tracked separately as T-822 BLOCKED and does not alter the T-761 review verdict.

## Conclusion

PASS. The reviewed workspace and compact Kanban changes follow Clean Architecture, KISS, YAGNI, and DRY principles. No follow-up ticket is required for the non-blocking formatting observation; do not add a fitness-test exception.

# T-896 Independent Review 2

Status: active

**Verdict: PASS**

## Scope and review basis

Reviewed the canonical ticket at `/home/jim/git/working-notes/.../pi-kanban/tasks/T-896.md`, `docs/plans/t-896-priority-order.md`, the implementation report, the follow-up review, and the changed `extensions/pi-kanban/` and `tests/kanban/` files read-only. The required shared state file was read from `/home/jim/git/working-notes/.../STATE.md`; the implementation report's `/tmp/working-notes/...` path is not present in this worktree.

No concurrent edits were observed: the worktree status was unchanged before and after validation. No source, test, settings, provider, Kanban-board, commit, or remote operation was performed.

## Behavioral verification

- `board.ts` normalizes priority case and surrounding whitespace, ranks `critical → high → medium → low`, and puts missing/empty/unknown values after `low`. The explicit original index preserves canonical `BoardState.order` ties. Parser-created legacy tasks default to `medium`.
- `overlay-model.ts` and `snapshot-model.ts` share the same active-column ordering. Done bypasses priority sorting and retains its existing canonical-history/recent bounded behavior; snapshot age filtering remains intact.
- The overlay header visibly emits fixed `[priority ↓]`; snapshot summary and full snapshot document the same contract. No rank/schema/event/WIP/claim changes were introduced.
- The controller restores the selected task by ID after a live rebuild/reorder. If the task is deleted or moved out of the active column, it uses a bounded valid-row/column fallback rather than retaining an invalid index. Filter entry captures the pre-filter ID; typing, no-match, backspace, Enter, and Escape restore that anchor where available.
- Scroll offset is clamped through `clampScrollOffset`; the controller applies it to the same `scroll` object passed to rendering. The existing renderer intentionally displays all rows (`max(8, column lengths)`), so the actual controller's effective visible window is never smaller than its active column and offsets clamp to zero. The helper also covers nontrivial offset/row clamping.

## Validation evidence

- Focused T-896 suite (six Kanban files): **35 passed, exit 0**.
- Full `npm test -- --run`: **211 files / 1560 tests passed, exit 0**.
- `npm run check`: **exit 0**. It reported existing Biome diagnostics (26 warnings and 89 informational diagnostics), but all check stages completed successfully.
- `git diff --check`: **exit 0**.
- Disposable `origin/main` archive with the new selection helper and controller/selection tests copied in: **exit 1**. Four tests passed and the controller filter-anchor test failed because Escape restored `T-010` instead of the anchored `T-011`; the corrected worktree passes that test. This demonstrates sensitivity of the added regression coverage.

The implementation is accepted within the documented bounded semantics: task-ID identity is preserved when the task remains in the rendered column, while deletion or movement out of that column receives deterministic valid-row fallback; filesystem event delivery remains platform-dependent rather than being claimed as guaranteed.

## Documentation-only delta check

A subsequent read-only check found a narrow `docs/architecture.md` Mermaid update: it adds the overlay selection/scroll helper and deterministic priority-order relationships from Board to Overlay and Snapshot. This matches the T-896 plan footprint and does not alter source behavior. The three T-896-related reports (`t-896-implementation.md`, `t-896-independent-review.md`, and this report) all contain `Status: active`. No documentation defect changes the PASS verdict.

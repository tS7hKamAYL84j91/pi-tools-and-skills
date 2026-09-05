# T-896 Independent Review — Follow-up

Status: active

Date: 2026-09-05
Disposition: **READY FOR GM REVIEW**

## Resolution evidence

The review-required coverage and bounded filter-anchor gap are addressed without adding UI controls, persistence, schema, or dependencies.

- `overlay-selection.ts` is used by the controller for task-ID row restoration and scroll-offset clamping.
- `overlay.ts` captures a filter-session selected ID on `/`, restores it on backspace/Enter/Escape, and preserves the previous populated board across transient empty direct rewrites.
- Controller tests cover filter typing, backspace, Enter, Escape, no-match rendering, and the existing all-rows viewport contract.
- Helper tests cover live priority reorder, deletion/move fallback, filter-session anchor restoration, and scroll clamping.
- `pi-kanban-board.test.ts` parses a legacy CREATE event with omitted priority and proves the `medium` fallback.

## Baseline/current runs

Disposable `git archive HEAD` copy, with only the new helper and tests copied in and shared installed dependencies:

```text
BASELINE_EXIT=1
5 tests: 4 passed, 1 failed
Failure: expected restored filter selection T-011, received T-010
```

Current worktree:

```text
Focused controller/selection suite: 2 files, 5 tests passed, exit 0
Full npm test -- --run: 211 files, 1560 tests passed, exit 0
npm run check: exit 0
npm run check output: Biome 26 warnings and 89 infos; no check failure
tests/architecture.test.ts: 68 tests passed, exit 0
git diff --check: exit 0
Documentation gate: all new reports have `Status: active`; the existing Kanban Mermaid component records shared priority ordering and selection/scroll helper boundaries.
```

The baseline is intentionally red on the acceptance behavior; the current implementation is green. No claims are made that unrelated diagnostics are absent.

## Remaining risks

The required state file was absent from the isolated environment, and no canonical T-896 ticket artifact was discoverable in permitted paths. The watcher remains subject to host filesystem-watch delivery; deterministic selection/scroll rules and controller input behavior are covered without introducing unsupported UI.

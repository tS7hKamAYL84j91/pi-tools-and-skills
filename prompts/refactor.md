---
description: Refactor code to be clean, pure, and minimal — YAGNI, KISS, TDD
---
Refactor the codebase (or the file/module $@) to maximize maintainability without altering external behaviour.

## Principles
- **YAGNI** — delete speculative features, unused abstractions, and "just-in-case" code.
- **KISS** — reduce cyclomatic complexity; favour readable, linear logic over clever or deeply nested patterns.
- **Functional purity** — move side effects to the edges; internal logic should be composed of pure, deterministic functions.
- **Interface stability** — preserve all public API contracts; downstream callers must not break.

## Process
1. **Baseline** — run the full test suite and confirm it is green.
2. **Characterise** — if a module lacks coverage, write characterisation tests to lock in current behaviour before touching the code.
3. **Refactor** — apply changes in small, incremental steps.
4. **Verify** — run tests after every change; zero regressions permitted.

## Static analysis (run before and after)
- **TypeScript:** `knip` or `ts-prune` for unused exports/files; `eslint-plugin-sonarjs` for complexity.
- **Python:** `vulture` for dead code; `mypy --strict` for types; `radon` for complexity.

## Output
1. **Deletion log** — files, functions, and variables removed.
2. **Purity report** — functions converted to pure, side-effect-free form.
3. **Test results** — confirmation all tests pass after refactoring.
4. **Final code** — clean, strictly typed, with no dead paths.

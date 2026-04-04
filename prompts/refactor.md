---
description: Refactor code to be clean, pure, and minimal — YAGNI, KISS, TDD. Enforced by architectural fitness functions and knip dead-code analysis.
---
Refactor the codebase (or the file/module $@) to maximize maintainability without altering external behaviour.

## Principles
- **YAGNI** — delete speculative features, unused abstractions, and "just-in-case" code.
- **KISS** — reduce cyclomatic complexity; favour readable, linear logic over clever or deeply nested patterns.
- **Functional purity** — move side effects to the edges; internal logic should be composed of pure, deterministic functions.
- **Interface stability** — preserve all public API contracts; downstream callers must not break.

## Process
1. **Baseline** — run the full check suite (`npm run check && npm test`) and confirm it is green.
2. **Characterise** — if a module lacks coverage, write characterisation tests to lock in current behaviour before touching the code.
3. **Refactor** — apply changes in small, incremental steps.
4. **Verify** — run tests after every change; zero regressions permitted.

## Structural dead-code analysis — knip

Run `npm run knip` before and after every refactoring pass. Knip must report **zero findings**.

Knip detects:
- **Unused files** — source files not reachable from configured entry points.
- **Unused exports** — exported functions, types, constants, and classes with no consumers.
- **Unused dependencies** — packages in `package.json` that are never imported.
- **Unlisted dependencies** — imports referencing packages not declared in `package.json`.
- **Unresolved imports** — import paths that don't resolve to a file or package.
- **Duplicate exports** — the same symbol re-exported from multiple locations.

Rules:
- **Do not** export functions, types, or constants unless consumed outside the file.
- Tag intentionally public API types with `/** @public */` if knip flags them.
- If a new dependency is only needed at runtime via a transitive package, add it to `ignoreDependencies` in `knip.json` with a comment.
- After deleting code, re-run knip — removals often cascade (deleting a function may orphan its type imports).

Config: `knip.json`. Docs: [knip.dev](https://knip.dev).

## Architectural fitness functions — ArchUnit

The test suite (`tests/architecture.test.ts`) enforces structural invariants via [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS). All architectural tests must pass after every refactoring step.

### Enforced rules

| # | Rule | Rationale |
|---|------|-----------|
| 1 | **Dependency direction** — `lib/` must not import from `extensions/` or `tests/` | Keeps the shared library independent of consumers |
| 2 | **Types leaf isolation** — `types.ts` must not import sibling extension modules | Types stay pure data; no coupling to runtime logic |
| 3 | **Extension isolation** — extensions must not import from other extensions | Each extension is a standalone vertical slice |
| 4 | **No circular dependencies** — both `extensions/` and `lib/` must be cycle-free | Cycles cause tangled builds and unpredictable load order |
| 5 | **File size limits** — extension files ≤ 500 lines, lib files ≤ 200 lines | Clean Code: small, focused modules |
| 6 | **Render path safety** — no sync I/O (`readAllPeers`) inside `render()` closures | Prevents blocking the TUI paint loop |
| 7 | **Documentation** — every extension `.ts` file starts with a `/** JSDoc */` comment | Ensures every module is self-documenting |
| 8 | **Function parameters** — max 4 params per function (extensions and lib) | Clean Code: 3 ideal, 4 upper bound |
| 9 | **Class cohesion** — LCOM96b < 0.8 for extension classes | High cohesion = single responsibility |
| 10 | **Error handling** — no empty `catch` blocks (must contain a comment) | Forces deliberate error-handling decisions |
| 11 | **Module structure** — `index.ts` has exactly one `export default` | Single entry point per extension |

### How to use during refactoring
- **Before splitting/moving a file:** check rules 1–4 (dependency direction, isolation, cycles). Run `npm test -- tests/architecture.test.ts`.
- **After extracting a module:** verify it stays under the line limit (rule 5) and has a JSDoc header (rule 7).
- **After changing function signatures:** confirm param count ≤ 4 (rule 8).
- **After adding a new extension:** ensure it doesn't cross-import from existing extensions (rule 3).

## Full validation suite

Run before committing:
```bash
npm run check   # typecheck → lint → knip → type-coverage
npm test        # vitest (unit + architectural fitness)
```

## Output
1. **Deletion log** — files, functions, and variables removed.
2. **Knip report** — confirmation of zero unused exports, files, and dependencies.
3. **Architecture test results** — all fitness functions green.
4. **Purity report** — functions converted to pure, side-effect-free form.
5. **Test results** — confirmation all tests pass after refactoring.
6. **Final code** — clean, strictly typed, with no dead paths.

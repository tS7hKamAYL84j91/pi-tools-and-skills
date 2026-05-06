---
description: Refactor code to be clean, pure, and minimal — YAGNI, KISS, TDD, architecture fitness, and knip dead-code analysis.
---
Refactor the codebase, or the file/module named in `$@`, to maximize maintainability without changing external behaviour.

## Principles
- **YAGNI** — delete speculative features, unused abstractions, and just-in-case code.
- **KISS** — reduce cyclomatic complexity; prefer readable, linear logic over clever or deeply nested flow.
- **Functional purity** — keep side effects at the edges; make internal logic pure and deterministic where practical.
- **Interface stability** — preserve public API contracts; downstream callers must not break.

## Process
1. **Baseline** — run `npm run check && npm test`; continue only from a green baseline.
2. **Characterise** — if touched behavior lacks coverage, add tests that lock in current behavior before refactoring.
3. **Refactor incrementally** — make small, behavior-preserving changes.
4. **Verify after each pass** — run focused tests plus `npm run knip`; fix regressions immediately.
5. **Final validation** — run the full suite before reporting completion.

## Required analysis

### Dead-code analysis — knip
Run `npm run knip` before and after refactoring passes. It must report zero findings.

Knip detects unused files, unused exports, unused dependencies, unlisted dependencies, unresolved imports, and duplicate exports.

Rules:
- Do not export functions, types, constants, or classes unless consumed outside the file.
- Tag intentionally public API types with `/** @public */` if knip flags them.
- If a runtime-only transitive dependency must be ignored, add it to `knip.json` with a justification comment.
- Re-run knip after deleting code; removals often cascade.

Config: `knip.json`. Docs: <https://knip.dev>.

### Architectural fitness — ArchUnitTS
`tests/architecture.test.ts` enforces structural invariants. Run it whenever moving/splitting modules or changing extension structure.

| # | Rule | Rationale |
|---|------|-----------|
| 1 | `lib/` must not import from `extensions/` or `tests/` | Keep shared library independent |
| 2 | `types.ts` must not import sibling extension modules | Keep types as pure data |
| 3 | Extensions must not import from other extensions | Keep vertical slices isolated |
| 4 | `extensions/` and `lib/` must be cycle-free | Avoid tangled build/load order |
| 5 | Extension files ≤ 500 lines, lib files ≤ 200 lines | Keep modules focused |
| 6 | No sync I/O (`readAllPeers`) inside `render()` closures | Protect TUI paint loop |
| 7 | Every extension `.ts` file starts with `/** JSDoc */` | Keep modules self-documenting |
| 8 | Max 4 params per function | Keep APIs simple |
| 9 | Extension class LCOM96b < 0.8 | Preserve class cohesion |
| 10 | No empty `catch` blocks; include a comment | Make error handling intentional |
| 11 | `index.ts` has exactly one `export default` | Single extension entry point |

## Full validation
```bash
npm run check   # namespace → typecheck → lint → knip → type-coverage
npm test        # vitest unit + architecture tests
```

## Output
1. **Deletion log** — files, functions, variables, and exports removed.
2. **Knip report** — confirmation of zero unused exports, files, and dependencies.
3. **Architecture results** — architectural fitness functions green.
4. **Purity report** — logic made pure or side effects moved to edges.
5. **Test results** — focused and full-suite results.
6. **Final code summary** — changed files and externally visible behavior preserved.

---
description: Simplify the requested code while preserving behavior and verifying the result.
---
Refactor the target named in `$@`, or the code relevant to the current task,
for easier maintenance without changing external behavior. If no target is
clear, ask. Keep the scope bounded; do not expand into unrelated cleanup.

## Principles

- **YAGNI** — no speculative features or just-in-case abstractions.
- **KISS** — prefer straightforward, understandable code.
- **Functional purity** — keep side effects at the edges and internal logic pure
  and deterministic where practical.
- **Interface stability** — preserve externally observable behavior and public
  contracts.

## Execution

- Inspect git status, relevant code, callers, and tests first. Preserve unrelated
  work and distinguish pre-existing failures from regressions.
- Make the smallest useful change. Remove confirmed dead code and unnecessary
  indirection; preserve abstractions that make the code easier to understand or
  maintain. Prefer simpler code, not merely fewer files or lines; do not split
  files or add abstractions just to satisfy a metric.
- Preserve public contracts, persistence compatibility, and safety boundaries.
- Add characterization or regression tests where behavior needs protection.
- Run focused tests while working. Run architecture tests when changing module
  boundaries, and knip when changing exports or deleting code.
- Before finishing, run `npm run check`, `npm test`, and `git diff --check` when
  practical. Report anything not checked and why; do not weaken configured gates.

Briefly summarize what became simpler, checks performed, and remaining risks.
Report discovered behavior-changing fixes separately; do not silently include
them in the refactor.

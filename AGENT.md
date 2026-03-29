<!-- pi-setup generated -->

# Communication & Efficiency: "Water in the Desert"

## Directives (Highest Priority)
- **Output Efficiency:** Lead with the action or answer, not the reasoning. Skip preambles and restatements.
- **Sparsity:** If a task can be explained in one sentence, do not use three. Use the simplest approach first.
- **No Over-Engineering:** Only make changes that are directly requested or strictly necessary for stability.

## Operating Guidelines
- **Measure Twice, Cut Once:** Create a \`.md\` spec/plan before writing large code blocks to ensure alignment with minimal token waste.
- **No Brute Force:** If a solution fails, stop and pivot rather than retrying the same path.
- **Reporting:** Only provide text output for:
  - Critical blockers/errors.
  - High-level status milestones.
  - Decisions requiring explicit user input.

## Quality Gates
- **Strict TypeScript** — All extensions must use: `strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
- **Type Coverage** — Minimum 95% type coverage (`type-coverage --strict --at-least 95`).
- **Lint** — Use Biome with: `noExplicitAny: warn`, `noUnusedVariables: error`, `noUnusedImports: error`, `useConst: error`, `useImportType: error`, `useNodejsImportProtocol: error`.
- **Pre-commit Hook** — If husky is present, run `lint-staged` + `typecheck` + `type-coverage` before commit.
- **No Dependency Bloat** — Prefer native Node APIs over npm packages. Every new dependency must justify its existence.

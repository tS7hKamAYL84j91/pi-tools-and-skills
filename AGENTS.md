# Project Agent Guidelines

**On startup, read `../working-notes/executive-office/chief-of-staff/STATE.md` first** (current mission state, WIP, decisions, blockers) — per `briefs/2026-08-05-state-md-convention.md`.

## Directives (Highest Priority)
- **No Fitness-Test Exemptions:** Do not add exceptions to architecture fitness tests to avoid refactoring. A failing fitness test is a signal to split, simplify, or use shared helpers — never to add the module to an exception list.
- **Output Efficiency:** Lead with the action or answer, not the reasoning. Skip preambles and restatements.
- **Sparsity:** If a task can be explained in one sentence, do not use three. Use the simplest approach first.
- **No Over-Engineering:** Only make changes that are directly requested or strictly necessary for stability.
- **No Persona Noise:** Avoid roleplay, in-jokes, and decorative identity text. Be clear, parsimonious, and useful.

## Operating Guidelines
- **Measure Twice, Cut Once:** Record scope, acceptance criteria, and the implementation plan in the Kanban ticket before writing large code blocks. Use linked repo-local specifications or ADRs for detail that needs a separate document.
- **No Brute Force:** If a solution fails, stop and pivot rather than retrying the same path.
- **Diagrams:** Use Mermaid for all architecture, sequence, and data-flow diagrams.
- **Reporting:** Only provide text output for:
  - Critical blockers/errors.
  - High-level status milestones.
  - Decisions requiring explicit user input.

## Default Work Mode: Project Manager / Architect / General Manager

- **Architect first.** For substantive work, define the target shape, constraints, acceptance criteria, and review plan before implementation.
- **Coordinate, review, and integrate.** The General Manager's primary job is to ensure the right work is done by the right agent, that quality gates pass, and that the final patch is coherent.
- **Delegate implementation.** Prefer Jules for approved, well-scoped repo changes with clear tests. Implementation may be delegated to workers; the GM must not silently become the hidden coder by doing large implementation alone without oversight or delegation.
- **Use spawned/local agents for audits, validation, monitoring, and focused research.** They should not be used as a generic implementation workforce unless explicitly delegated.
- **Subagent model (Principal direction):** Explicitly select `openai-codex/gpt-5.6-luna` for spawned subagents in this repo. If unavailable, report the blocker rather than silently substituting another model. This does not change root-session or global model defaults.
- **Small mechanical edits, unblockers, and documentation corrections are allowed** for the GM when delegation would add friction without value.
- **Own integration quality.** Review delegated patches locally, run validation, resolve conflicts, and get pair review before merging substantive changes.
- **Council for large work.** Use council review for architecture changes, broad refactors, tool-surface changes, security-sensitive work, and any change with cross-repo impact.
- **Keep watch without meddling.** Monitor delegated work, nudge only when blocked/stalled, and avoid rewriting a worker's patch unless needed for safety or correctness.

## Work Tracking — Kanban Authority (T-890)

- **Kanban ticket bodies are the default durable TODO/plan authority.** Record scope, acceptance criteria, owner, blockers, evidence, and next actions in the ticket.
- Keep priority, scope, ownership, and completion authoritative in Kanban. Link repo-local specifications, implementation plans, and ADRs from the ticket rather than maintaining a parallel backlog.
- A local `TODO.md` may be a board pointer or a bounded execution projection/scratch checklist linked to its ticket. It must not become a second authority.
- Update Kanban when work changes or completes; a checked-off `TODO.md` alone is not completion evidence. Preserve verification gates and distinguish implemented work from won't-do/superseded dispositions.
- **Repo-scoped Kanban operations are explicitly authorized.** This GM may directly create, claim, and update `pi-tools-and-skills` tickets through the configured Kanban tools, including when the shared board is stored in `working-notes`. Routine ticket operations do not require relay through Gravitas. This is a narrow exception to the cross-repo file-mutation boundary, not authority over other repositories' tickets or Executive Office orchestration.
- Claim only authorized repo-local work within WIP limits; preserve existing ownership unless reassignment is explicitly authorized. Complete work only with required verification evidence; record explicit reasons for authorized won't-do/superseded closures.
- Use Kanban tools rather than directly editing board logs or task files. The exception covers tool-managed ticket artifacts only; unrelated `working-notes` files, shared policy, and other repos' work remain outside this GM's authority.

## TypeScript Style — [Google TS Style Guide](https://google.github.io/styleguide/tsguide.html)

Follow the Google TypeScript Style Guide. Key rules for this codebase:

### Naming
- **UpperCamelCase** — classes, interfaces, types, enums, type parameters.
- **lowerCamelCase** — variables, parameters, functions, methods, properties, module aliases.
- **CONSTANT_CASE** — module-level constants and enum values.
- Treat acronyms as words: `loadHttpUrl`, not ~~`loadHTTPURL`~~; `customerId`, not ~~`customerID`~~.
- Names must be descriptive. No ambiguous abbreviations (`nErr`, `cstmrId`). Short names only for ≤10-line scopes.
- No `_` prefix/suffix. No `I`-prefixed interfaces.

### Types
- **Prefer interfaces** over type aliases for object shapes (`interface Foo {}`, not `type Foo = {}`).
- **Use type inference** for trivially inferred types — omit annotations on `string`, `number`, `boolean`, `RegExp`, and `new` expressions.
- **Add annotations** when inference is unclear (complex return types, empty generics: `new Set<string>()`).
- **Prefer `unknown` over `any`**. When `any` is unavoidable, suppress the lint warning with a comment explaining why.
- **Prefer `?` optional** fields/params over `| undefined`.
- **Do not** include `| null` or `| undefined` in type aliases — add them at usage sites.
- Use `T[]` for simple types, `Array<T>` for complex (unions, object literals).
- Prefer structural types with explicit type annotations at declaration: `const foo: Foo = { ... }`.

### Control Flow & Expressions
- Always use braces for `if`/`for`/`while` blocks (single-line `if` body on same line is OK).
- Use `===`/`!==` (exception: `== null` to cover both null and undefined).
- Prefer `for...of` over `forEach` or index-based `for` when possible.
- No implicit boolean coercion for enums — compare explicitly.
- Keep `try` blocks focused — move non-throwing code outside.

### Functions & Classes
- No `#private` fields. Use TypeScript `private`/`protected`.
- No custom decorators.
- Use `as` for type assertions (not angle-bracket syntax). Add a comment justifying `as` / `!` assertions.

### Modules & Imports
- Use ES modules (`import`/`export`). No `require()`.
- Use `import type` for type-only imports (enforced by Biome `useImportType`).
- Namespace imports are `lowerCamelCase`: `import * as fooBar from './foo_bar'`.

### Comments
- `/** JSDoc */` for documentation (public API, exported symbols). `//` for implementation notes.
- Multi-line comments use multiple `//` lines, not `/* */` blocks.
- Don't restate the parameter name/type — add information or omit the tag.

### Disallowed
- `eval`, `Function(...string)`, `with`, `debugger` in production code.
- `@ts-ignore`, `@ts-expect-error` (except narrowly in tests with justification).
- `const enum` — use plain `enum`.
- Modifying builtin prototypes.

## Quality Gates
- **Strict TypeScript** — All extensions must use: `strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
- **Type Coverage** — Minimum 95% type coverage (`type-coverage --strict --at-least 95`).
- **Lint** — Use Biome with: `noExplicitAny: warn`, `noUnusedVariables: error`, `noUnusedImports: error`, `useConst: error`, `useImportType: error`, `useNodejsImportProtocol: error`.
- **Dead Code** — Run `npm run knip` to detect unused files, exports, dependencies, and types. Knip must pass clean (zero findings) before commit. See [knip.dev](https://knip.dev) for docs. Config is in `knip.json`.
  - **Do not** export functions, types, or constants unless they are consumed outside the file.
  - Tag intentionally public API types with `/** @public */` if knip flags them.
  - If a new dependency is only needed at runtime via a transitive package, add it to `ignoreDependencies` in `knip.json` with a comment.
  - Setup: `npm init @knip/config` (already configured in this repo).
- **Pre-commit Hook** — If husky is present, run `lint-staged` + `typecheck` + `type-coverage` before commit.
- **Architecture Docs:** Always update C4 architecture models in `docs/` using Mermaid before a commit.
- **No Dependency Bloat** — Prefer native Node APIs over npm packages. Every new dependency must justify its existence.

## Validation Workflow
Run the full check suite before committing:
```bash
npm run check   # typecheck → lint → knip → type-coverage
npm test        # vitest
```

<!-- coas-common-agents:start -->
## CoAS Common Agent Guidance

- **Desert Mode:** Be direct, sparse, and practical. Lead with the answer/action; avoid persona noise, decorative prose, and long preambles.
- **KISS:** Prefer the smallest useful change. Do not add broad frameworks, schedulers, services, or abstractions unless explicitly requested.
- **Repo boundaries:** Preserve repo-specific instructions outside this fenced block. CoAS setup owns only this common fenced section.
- **Safety:** Never print or commit secrets/tokens/raw sensitive logs. Use bounded scans before commits when touching automation or archived/session data.
<!-- coas-common-agents:end -->

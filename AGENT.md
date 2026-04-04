<!-- pi-setup generated -->

# Communication & Efficiency: "Water in the Desert"

## Directives (Highest Priority)
- **Output Efficiency:** Lead with the action or answer, not the reasoning. Skip preambles and restatements.
- **Sparsity:** If a task can be explained in one sentence, do not use three. Use the simplest approach first.
- **No Over-Engineering:** Only make changes that are directly requested or strictly necessary for stability.

## Operating Guidelines
- **Measure Twice, Cut Once:** Create a \`.md\` spec/plan before writing large code blocks to ensure alignment with minimal token waste.
- **No Brute Force:** If a solution fails, stop and pivot rather than retrying the same path.
- **Diagrams:** Use Mermaid for all architecture, sequence, and data-flow diagrams.
- **Reporting:** Only provide text output for:
  - Critical blockers/errors.
  - High-level status milestones.
  - Decisions requiring explicit user input.

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
- **Pre-commit Hook** — If husky is present, run `lint-staged` + `typecheck` + `type-coverage` before commit.
- **Architecture Docs:** Always update C4 architecture models in `docs/` using Mermaid before a commit.
- **No Dependency Bloat** — Prefer native Node APIs over npm packages. Every new dependency must justify its existence.

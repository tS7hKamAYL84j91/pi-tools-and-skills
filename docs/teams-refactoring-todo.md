# Teams Refactoring TODO

## Goal

Tighten the `pi-llm-council` teams abstractions so core team concepts, persistence, runtime handlers, tools, commands, and UI concerns are separated.

## Acceptance criteria

- Team type definitions are isolated from registry/runtime/tool/UI code.
- Team path and project-root resolution logic is centralized.
- Team registry/descriptor loading remains the single source for built-in/user/project discovery.
- Team file create/update/delete behavior is isolated behind repository/persistence helpers.
- Protocol execution is dispatched through handler abstractions instead of a central `if` chain.
- Protocol handlers own model slot metadata used by interactive model configuration.
- Existing public tools and `/teams` command behavior remain compatible.
- `npm run check` and `npm test` pass.

## Refactoring tasks

Status: implemented.

1. [x] Extract team types into `team-types.ts`.
2. [x] Extract shared path helpers into `team-paths.ts`.
3. [x] Move descriptor loading and registry construction into `team-registry.ts`.
4. [x] Move user-default seeding into `team-defaults.ts`.
5. [x] Keep file mutation/create/update/delete logic in `team-form.ts`, but route path decisions through `team-paths.ts` and registry decisions through `team-registry.ts`.
6. [x] Introduce protocol handler interfaces in `team-handlers.ts`:
   - `key`
   - `matches(team)`
   - `modelSlots(team, models)`
   - `run(args)`
7. [x] Move debate, pair-coding, pair-consult, and telephone execution into handlers.
8. [x] Update `team-models.ts` to use handler-provided model slots.
9. [x] Move team list/describe tools out of registry code into `team-tools.ts`.
10. [x] Keep `/teams` command registration separate from execution dispatch where practical.
11. [x] Update imports/tests/docs after file moves.

## Non-goals

- Do not change tool names or `/teams` command syntax.
- Do not redesign the Markdown frontmatter schema in this pass.
- Do not add dependencies.
- Do not change council/pair prompt semantics.

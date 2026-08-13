# Extension Path-Confinement Refactor

## Goal

Close three verified model/public filesystem boundary defects without changing intended operator configuration:

1. Panopticon `team_form` subagent IDs must not escape the configured agents directory.
2. Goal file sources must remain inside the project after resolving symlinks.
3. `pi_ollama_sync_models` must not expose executable and arbitrary write-path overrides to model callers.

## Constraints

- Preserve safe existing team IDs and `agent:<registered-name>` live bindings.
- Use safe-ID validation plus resolved containment for generated subagent create/delete paths.
- Goal confinement must reject symlink components/real paths outside the project before reading content.
- Ollama `modelsPath` and `ollamaCommand` remain trusted internal/env/test injection only; the model-visible schema exposes `dryRun` only.
- Do not add dependencies or change persistence formats.
- Do not touch fitness budgets/exceptions.

## Acceptance criteria

- Team form/create/delete tests reject `../`, separators, absolute IDs, and encoded unsafe names without touching outside files.
- Goal tests reject direct and intermediate symlink escapes while accepting ordinary in-project files.
- Ollama public registration/execute tests prove caller path/command overrides are unavailable; internal helper/env tests remain hermetic.
- Focused tests, `npm run check`, `npm test`, and `git diff --check` pass.

## Implementation plan

1. Validate every generated subagent basename and assert its resolved create/delete path remains under the configured agents directory; leave live-agent refs outside filesystem handling.
2. Resolve Goal sources asynchronously, reject symlink components, and verify real-path project containment before any source read.
3. Narrow the Ollama tool schema and execute adapter to `dryRun`, retaining command/path overrides only in trusted internal and environment configuration.
4. Add boundary-focused tests, then run focused and full quality gates without fitness-test exceptions.

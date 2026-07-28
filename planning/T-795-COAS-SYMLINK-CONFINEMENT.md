# T-795 — CoAS symlink-confinement remediation plan

## Goal

Close the CoAS file-operation symlink-escape gap without breaking explicitly selected external workspaces.

## Current gap

`extensions/pi-coas/store.ts` has `assertNoSymlinkComponents(root, target)`, but most filesystem helpers accept only an unguarded path. Lexical `assertInside()` does not prevent a symlink under an allowed root from resolving outside it.

Affected helpers:

- `ensurePrivateDir`
- `fileExists`
- `readOptionalFile`
- `writePrivateFileAtomic`
- `removePrivateFiles`
- `countDirectories`
- `newestFile`

## Constraints

- This is a security remediation; no fitness-test waivers.
- Preserve external workspace compatibility only for workspaces explicitly authorized by `.pi/coas/workspace.env`.
- Do not make root-model, routing, residency, cadence, or unrelated API changes.
- Helper exports are extension-internal today, but changing their signatures touches multiple modules and tests; obtain council decision on the API shape before implementation.

## Candidate API shapes

1. **Explicit root parameter**: make every guarded helper accept `(root, target, ...)` and call `assertNoSymlinkComponents(root, target)` before filesystem operations. Strong/clear but broad internal signature migration.
2. **Scoped guard object**: construct an internal `ConfinedStore(root)` with guarded methods. Better cohesion but larger refactor.
3. **Separate guarded helpers while retaining legacy helpers**: smallest migration but risks callers retaining the unsafe path and leaves a confusing API.

## Council decision — 2026-07-28

`llm-council` selected **a scoped `ConfinedStore(root)` with async static factories**; ADR-038 records the decision.

- Existing absolute targets remain supported, but every operation guards lexical confinement and symlink components.
- Factory validation is mandatory: validate the full chain from `config.coasHome` to a managed sub-root; validate external roots after existing metadata authorization.
- Add `readRequiredFile` for raw schedule `.env` reads.
- Directory listing helpers throw on symlinked entries; `removePrivateFiles` validates all paths before any removal.
- Migrate all consumers and remove legacy unguarded exports immediately; no compatibility/deprecation window.
- Residual TOCTOU risk is documented and deferred to a separate hardening task.

## Security test matrix

- Symlinked intermediate directory under CoAS home rejects read/write/remove/list operations.
- Symlinked final file rejects read/write/remove.
- Normal CoAS home/schedule/workspace paths remain functional.
- Explicit external workspace with metadata remains functional and rejects internal symlink components.
- Unmarked external workspace remains rejected.
- Existing exported helper consumers compile after the selected API migration.

## Acceptance criteria

- All affected operations enforce component-level symlink checks under an explicit trusted root.
- No lexical-only path guard remains on a security-sensitive operation.
- External-workspace compatibility follows the explicit metadata rule and has tests.
- `npm run check`, `npm test`, and `npm run security:semgrep` pass with no exemptions.

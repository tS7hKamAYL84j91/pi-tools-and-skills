# T-795 Implementation Report

Status: active

## Baseline

Regression tests were added before the implementation. The initial focused run was RED only for the new non-regular-target assertion: reading a directory produced raw `EISDIR` instead of a confined regular-file rejection. The existing symlink regression cases were already GREEN on the historical/current baseline; this patch therefore does not claim to newly prove closure of a previously failing CoAS symlink case.

## Implementation

- Added native resolved-location validation as defense-in-depth alongside lexical containment and existing `lstat` component checks.
- Revalidated directory paths after recursive creation.
- Rejected non-regular read targets and existing non-regular write/append substitutions.
- Preserved CoAS-specific error wording and external workspace authorization.
- Split shared filesystem validation into `lib/confined-store-security.ts` to remain within architecture module budgets; registered it as a genuine shared primitive with multiple callers.
- Kept all existing exported helper and method signatures unchanged.

## Verification

- Focused CoAS security, consumer-symlink, property, unit, and architecture tests: PASS (83 tests in final focused run). The symlink cases were baseline-green; the new RED→GREEN regression is the non-regular `EISDIR` hardening case.
- Full `npm test`: PASS — 209 files, 1,554 tests.
- `npm run check`: PASS — typecheck, namespace/template checks, lint, knip, and type coverage.
- Type coverage: 99.23%.
- Targeted Biome lint and TypeScript diagnostics: PASS. Full lint reports existing informational diagnostics/warnings outside this change but exits successfully.
- `git diff --check`: PASS.
- Bounded redacted secret-pattern scan over the diff: no findings.

## Changed files

- `lib/confined-store.ts`
- `lib/confined-store-security.ts`
- `extensions/pi-coas/store.ts`
- `tests/coas/pi-coas-store-security.test.ts`
- `tests/architecture/lib-layering.ts`
- `docs/plans/t-795-path-security.md`

## Residual limits and review gates

Validation still uses check-then-use filesystem operations. A concurrent attacker may replace a checked component between `lstat`/`realpath` and the subsequent operation; eliminating that TOCTOU class would require descriptor-relative APIs and broader redesign. The fix closes ordinary existing and newly-created symlink/non-regular substitutions while retaining lexical confinement and external roots.

No commit, push, merge, Kanban mutation, settings/provider change, or cross-repository write was performed. Stop here for independent security review before integration.

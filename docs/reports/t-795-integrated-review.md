# T-795 integrated candidate review

Status: active

GM integration checks: `npm run check` PASS (99.23%, clean knip); `npm test -- --maxWorkers=2` PASS (217 files, 1608 tests); primary LSP on three changed source modules clean. Independent review body follows.

## Verdict: PASS (bounded scope only)

The integrated candidate is acceptable for the stated narrow T-795 scope: non-regular-object hardening and resolved-path defense in depth. It does not claim to close a historically failing symlink gap, and it retains the explicit check-then-use/TOCTOU limitation.

## Executed evidence

- `npx vitest run tests/coas/pi-coas-store-security.test.ts tests/architecture.test.ts tests/architecture/lib-layering.ts`: **2 files, 78 tests passed, exit 0** (the architecture helper module is exercised through `tests/architecture.test.ts`).
- Security coverage includes non-regular reads, symlink components, newly-created descendants, external authorized workspace/archive preservation, deletion prevalidation, and symlink directory entries (`tests/coas/pi-coas-store-security.test.ts:29-122`).
- Historical evidence remains distinct: the prior disposable baseline comparison showed symlink cases already GREEN and only the new non-regular directory-read case RED; this review did not relabel that as historical symlink-gap closure.
- No source/test edits, live schedules, commits, or provider/config actions were performed.

## Source/API audit

- `lib/confined-store-security.ts` supplies native absolute-path, component, resolved-root, root, and recursive-creation validation (`:1-68`).
- Both production consumers use the shared helper: `lib/confined-store.ts` imports and routes through it (`:7-15,31-65,96-143`), and `extensions/pi-coas/store.ts` imports/uses it (`:7-14,90-129`). The architecture registration is therefore a genuine two-consumer shared primitive, not a fitness-test exemption.
- `ConfinedStore` public factories and operation signatures remain compatible; CoAS-specific external-workspace authorization and archive compaction are covered by `pi-coas-store-security.test.ts:42-56`.
- Non-regular read/write/append substitutions are explicitly rejected, recursive directory creation is revalidated, and resolved-path checks add defense in depth. Validation remains check-then-use; hostile concurrent replacement/TOCTOU is not claimed solved.

## Documentation/integration audit

- `docs/reports/t-795-final-review.md` records **PASS for bounded scope**, preserves the no-historical-symlink-closure distinction, and identifies the TOCTOU residual.
- `docs/reports/t-795-implementation.md` and `docs/reports/t-795-t-888-council-safety.md` are marked `Status: active` and state the same bounded contract.
- `docs/architecture.md` documents the shared confinement boundary and residual TOCTOU limitation; the shared helper split is represented without an exemption.
- The candidate leaves pi-goal untouched. T-888 overlap remains a future reconciliation concern, not a reason to broaden or duplicate this boundary.

No blocker found within the reviewed T-795 acceptance scope. This PASS must not be expanded into a historical symlink-remediation or race-resistant-confinement claim.

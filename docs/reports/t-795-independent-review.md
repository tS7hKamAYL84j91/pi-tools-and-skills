# T-795 Independent Security Review

Status: active

## Verdict: REVISE

The implementation is not ready for integration. The main issue is evidence/claim integrity: the corrected tests do not demonstrate the ticket's historic CoAS symlink-escape gap against the current source baseline.

## Findings

### 1. Symlink regression is not sensitive to the claimed historic gap — material

I ran the changed security test file against a disposable `git archive origin/main` copy, copying only the current test file and using the existing installed dependencies:

- `tests/coas/pi-coas-store-security.test.ts`: **9 passed, 1 failed, exit 1**.
- The sole failure was the new non-regular read-target assertion: baseline returned raw `EISDIR`, not the expected regular-file rejection.
- All symlink cases, including intermediate/final links, external metadata-chain link, and the newly-created-descendant link case, passed on `origin/main`.

Therefore the regression suite proves **non-regular-object hardening**, but does not prove that this patch closes a previously failing symlink-escape behavior. The current baseline already performed lexical `lstat` component checks. The added resolved-path checks are defense-in-depth only; the report must distinguish that from historical closure and must not claim a reproducible symlink escape without one.

### Historical/current source evidence

The ticket describes a pre-existing gap from the July 2026 lexical-only helper change. The repository history shows that this was subsequently superseded: commit `1a7674a` records ADR-038's accepted scoped-confinement decision; commit `e0e818d` is the historical lexical `assertInside` change; and commits `0efe51c`, `bd047bd`, and `e36e7a8` (2026-08-21) extracted/adopted the shared `ConfinedStore` with path-component symlink checks. The current `origin/main` source and its symlink regressions are therefore not the vulnerable pre-ADR state described by the ticket. This lane's source change is limited to defense-in-depth and non-regular-object hardening evidence; it does not establish historic symlink-gap remediation.

### 2. Required architecture fitness run — corrected

The prior review found a report-hygiene failure because `docs/reports/t-795-implementation.md` lacked `Status: active`. That metadata is now present. The actual rerun was:

```text
npx vitest run tests/architecture.test.ts
1 file passed, 68 tests passed, exit 0
```

This correction does not add an architecture exemption. `npm run check` still does not execute the architecture suite, so the explicit architecture run remains the relevant evidence.

### 3. Security design boundary requires council before integration

The patch materially changes a shared filesystem security primitive and adds resolved-path checks while explicitly retaining check-then-use operations. The stated TOCTOU limit is accurate: an attacker can replace a checked component between validation and use; eliminating that class requires descriptor-relative/openat-style APIs and a broader design. Because the historic symlink gap is not demonstrated and the residual race boundary is security-material, obtain design-council disposition before integration rather than treating this as an uncontroversial closure.

The council/owner decision should also state whether the target is ordinary pre-existing substitution hardening or a stronger race-resistant guarantee, and what evidence is required for either claim.

## Code review observations

- `lib/confined-store-security.ts` is a genuine shared primitive with production callers from both `lib/confined-store.ts` and `extensions/pi-coas/store.ts`; the `tests/architecture/lib-layering.ts` registration is not an exemption. The two-callers requirement is met.
- Existing exported `ConfinedStore` and CoAS helper method signatures appear preserved. Managed roots remain bound through the CoAS store, and authorized external workspace roots use their own validated root; the archive-compaction test passes on the corrected worktree. These are compatibility observations, not evidence of historic symlink-gap closure.
- All observed consumers of `ConfinedStore` route file operations through the guarded methods, including approval inbox, schedules, scheduler logs/run state, workspaces, status, and workspace-context archive writes. No direct consumer bypass was found in the reviewed CoAS paths.
- Non-regular read targets are now rejected explicitly. Directory enumeration rejects symlink entries. Recursive directory creation is revalidated after creation. These are valid hardening changes, but they do not by themselves establish the ticket's historic symlink-gap closure.
- Overlap with T-888 is limited but should be integrated carefully: T-888 is expected to touch scheduler run-state persistence and may use the same CoAS `ConfinedStore` paths. Keep the shared primitive in `lib/` as the single boundary, avoid parallel copies of confinement logic, and reconcile scheduler-run-state changes with this patch before merge.

## Validation evidence

- Focused security/property run: **13 passed, exit 0** (the architecture `.ts` modules are imported by `tests/architecture.test.ts`, not standalone test files).
- `npx vitest run tests/architecture.test.ts`: **68 passed, exit 0** after the report-hygiene correction.
- `npm run check`: **exit 0**. It completed typecheck, lint, knip, and type coverage; existing Biome warnings/informational diagnostics were reported but did not fail the pipeline.
- `git diff --check`: **exit 0**.
- Worktree status remained unchanged during review; no source/test edits, commits, pushes, merges, settings/providers, or live operations were performed.

## Required follow-up

1. The implementation/report claim is now narrowed to non-regular and defense-in-depth hardening; do not invent a symlink-closure claim. If historic remediation is still required, obtain the actual vulnerable pre-ADR source and a regression that fails there.
2. Preserve the corrected `Status: active` report metadata and rerun architecture evidence if report state changes.
3. Obtain council disposition for the security boundary and TOCTOU scope before integration, especially before combining with T-888 scheduler/run-state work.

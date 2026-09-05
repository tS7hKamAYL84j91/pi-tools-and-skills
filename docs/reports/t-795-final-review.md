# T-795 Final Read-Only Audit

Status: active

Date: 2026-09-05

## Verdict

**PASS for the independently accepted bounded T-795 hardening scope.** The candidate supports non-regular-object hardening and resolved-path defense in depth. It does **not** establish closure of a historical symlink gap: the reviewed symlink cases were already green on `origin/main`. The explicit check-then-use/TOCTOU limitation remains accepted.

T-795 may integrate its shared hardening independently before T-888. The T-888 ADR/index and scheduler-graph documentation are T-888 delivery requirements, not prerequisites for T-795 code integration. A future overlap warning remains: T-888 must reconcile onto this single shared boundary rather than introduce a parallel confinement implementation.

## Rechecked T-795 boundary/docs

- `ConfinedStore` remains the single shared filesystem boundary.
- Existing public helper/factory signatures, authorized external workspace handling, and archive confinement remain documented as retained.
- `docs/architecture.md` now documents the shared `confined-store-security.ts` boundary, lexical plus resolved checks, regular-file/post-creation checks, and the residual TOCTOU limit in Mermaid/docs.
- The corrected council report has `Status: active`.
- `docs/adr/README.md` still does not index ADR-060; this is recorded as a T-888 delivery gap, not a T-795 integration blocker.

## Checks actually executed in this step

- `npx vitest run tests/architecture.test.ts`: **PASS — 68 passed**.
- Primary LSP diagnostics for the changed T-795 docs: **clean**.

Previously executed evidence remains distinct:

- Focused CoAS/security/property/layering run: **162 passed**.
- `npm run check`: **PASS**; type coverage **99.23%**.
- `npm test`: previously **1,553/1,554 passed**, with the then-inactive council report causing the sole docs-hygiene failure; not rerun in this step.
- Disposable `origin/main` comparison, reviewed rather than rerun here: **9 passed, 1 failed**, only the new non-regular directory expectation failed; symlink cases passed.

## Remaining T-795 evidence note

Keep all claims narrowed to defense-in-depth/non-regular hardening. Do not describe this as historical symlink-gap remediation or as race-resistant confinement. No source/test mutation, peer spawn, live operation, commit, settings change, or provider operation was performed.

## Future T-888 overlap warning

Before T-888 integration, its implementation must satisfy the accepted ADR-060 bounded design: token claim and lock-held token-conditional CAS, first-class approval/uncertainty, no age/PID/stale takeover, fail-closed malformed records, and the specified tests. It must use the reconciled shared confinement boundary. ADR-060 indexing and the scheduler C4/data-flow update belong to T-888 delivery.

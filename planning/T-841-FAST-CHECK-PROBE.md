# T-841 Fast-Check Property Probe

## Package review

- Candidate: `fast-check@4.4.0`, exact dev dependency.
- License: MIT.
- Registry integrity: `sha512-s87BFAp8YaWYOBXjbTxeotaOhmA4hPYAyk9gBTFxdab25P6eAlqrryUvVMA2qd9bT/0Xq+YNJGtoVhJd/BxI4g==`.
- Existing lockfile: v3, 461 packages, no package entries missing integrity or license fields; no existing `fast-check` dependency.

## Scope

Only pure contracts receive property tests:

1. Boost parser: generated option/prompt inputs preserve explicit parse/reject boundaries and combined UTF-8 cap.
2. Boost lease/reversion: generated terminal outcomes preserve one-yield accounting and reversion invariants through injected mocks only.
3. Confined-store/path boundaries: generated path segments prove rejection of escape/non-absolute/unsafe cases without filesystem mutation outside temporary fixtures.

## Guardrails

- Exact package version only; lockfile integrity must match the reviewed registry value.
- Seeded/replayable runs: read `FC_SEED` (integer) and print failing seed/path; default fixed seed.
- Cap every property (`numRuns <= 100`, bounded input lengths) and disable shrink output expansion beyond the test framework default.
- No live/provider/model/Q/config/default/scheduler/network calls in generated tests.
- No property test may write outside a test-created temporary root.

## Validation

- Focused property suite with a fixed seed and an override seed.
- `npm run typecheck`, `npm run check`, `git diff --check`.
- Verify package version, MIT license, and lock integrity after lock update.
- Write a minimized findings report with failing invariant/replay seed or an explicit no-finding result.
- Independent exact-diff review before commit.

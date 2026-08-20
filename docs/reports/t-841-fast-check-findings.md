# T-841 Fast-Check Findings

## Result

No invariant failure was found in the bounded property slice.

## Audit baseline

- `npm audit` reports 12 pre-existing findings: 1 moderate, 10 high, and 1 critical.
- No auto-fix was applied. The reviewed `fast-check` and `pure-rand` entries are not implicated.

## Evidence

- Dependency: exact `fast-check@4.4.0`, MIT, lock integrity `sha512-s87BFAp8YaWYOBXjbTxeotaOhmA4hPYAyk9gBTFxdab25P6eAlqrryUvVMA2qd9bT/0Xq+YNJGtoVhJd/BxI4g==`.
- Default run: 7 properties passed with 100 generated cases each using seed `8412026`.
- Override run: 7 properties passed with 100 generated cases each using `FC_SEED=123456`.
- Covered contracts:
  - boost option/prompt parsing and combined UTF-8 byte limits;
  - terminal-outcome one-yield accounting, one-time baseline reversion, and duplicate-settlement rejection through injected mocks;
  - safe/escaping CoAS paths, unsafe identifiers, and non-absolute `ConfinedStore` targets.
- Isolation: parser and path checks are pure; lease dependencies are in-memory mocks; the confined-store property only creates and removes a root under the operating-system temporary directory. No provider, live model, Q, config/default, scheduler, or network behavior is invoked.

## Replay

The harness fixes `numRuns` at 100 and defaults to seed `8412026`. Failures report the minimized seed and path. Replay a reported case with:

```bash
FC_SEED=<reported-seed> FC_PATH=<reported-path> npx vitest run <failing-property-file>
```

## Validation

```text
npx vitest run tests/boost/pi-boost-property.test.ts tests/coas/pi-coas-paths.property.test.ts
# 2 files passed; 7 tests passed

FC_SEED=123456 npx vitest run tests/boost/pi-boost-property.test.ts tests/coas/pi-coas-paths.property.test.ts
# 2 files passed; 7 tests passed

npm run typecheck
# passed

npm run knip
# passed

npm run check
# passed; type coverage 99.19%

git diff --check
# passed
```

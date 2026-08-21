# Track 4 — lib Layering Cleanse

## Target
- Keep `lib/` only for documented, dependency-light shared primitives with at least two production callers.
- Move CoAS-owned modules to `extensions/pi-coas/lib/`.
- Move spawn-owned modules to `extensions/pi-panopticon/spawner/`.
- Move CLI entrypoints to `scripts/`, preserving testable exports and command behavior.
- Make the architecture fitness test derive and enforce the shared-caller rule rather than maintaining stale filename exemptions.

## Constraints and acceptance
- Exclude `extensions/pi-boost/`.
- Update production, test, script, and documentation references.
- Preserve public behavior and strict TypeScript style.
- `npm run check` and `npm test` pass; Knip has zero findings and type coverage is at least 99.2%.
- Update architecture documentation and commit on `refactor/track-4-lib-cleanse`.

## Review plan
1. Inventory module ownership and callers before moving files.
2. Move modules with `git mv`, update relative imports and test mocks.
3. Replace layering fitness rules with documented shared primitive metadata and caller-count checks.
4. Run focused architecture/type tests, then full check and test suites; inspect the final diff and status.

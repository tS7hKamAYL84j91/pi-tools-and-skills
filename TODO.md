# TODO: Shared Declarative Configuration Discovery for Boost

## Goal

Configure `pi-boost` through the same layered discovery convention used by Panopticon Teams without making Boost a team or creating cross-extension dependencies.

## Architecture

- [x] Draft ADR-047 for council review before implementation.
- [x] Identify the smallest extension-neutral discovery behavior currently in `extensions/pi-panopticon/teams/team-paths.ts`.
- [x] Extract neutral root discovery, path expansion, precedence, and descriptor enumeration into `lib/`.
- [ ] Keep Team schemas, registry compilation, protocols, and execution inside `pi-panopticon`.
- [ ] Keep Boost configuration validation, Principal authorization, lease, lifecycle, rollback, and audit inside `pi-boost`.
- [ ] Make both extensions depend only on the shared `lib/` primitive, never on each other.
- [ ] Do not add a bespoke `pi-boost/config.json` discovery path.

## Implementation

- [x] Refactor Panopticon Teams discovery to use the shared primitive without changing existing behavior.
- [x] Add a Boost-specific declarative configuration adapter using the shared discovery convention.
- [x] Define a minimal Boost descriptor containing only required provider/model and bounded runtime settings.
- [x] Connect the validated Boost descriptor to the existing lease-controlled dispatch path.
- [x] Preserve fail-closed behavior and leave the session default model unchanged.

## Review and Simplification

- [ ] Complete an independent F.I.R.E. review using Dan Ward's simplicity criteria.
- [ ] Run `/code-analysis` over the affected architecture and implementation.
- [ ] Fix every confirmed bug or document an explicit blocker.
- [ ] Refactor and simplify the result using CLEAN, KISS, and DRY principles without introducing speculative abstractions.
- [ ] Remove redundant configuration paths, duplicated discovery logic, dead code, and unnecessary indirection.
- [ ] Re-run review after fixes to confirm that simplification preserved behavior and boundaries.

## Fitness and Tests

- [ ] Assert that `pi-boost` and `pi-panopticon` do not import from each other.
- [ ] Assert that shared discovery code contains no Team- or Boost-specific policy.
- [ ] Assert that both extensions use the shared discovery primitive.
- [ ] Assert that no bespoke Boost configuration fallback exists.
- [ ] Test built-in, user, and project discovery precedence.
- [ ] Add property-based tests for discovery precedence, path normalization, descriptor validation, bounded settings, and fail-closed inputs.
- [ ] Record deterministic property-test seeds so failures are reproducible.
- [ ] Test invalid, missing, and conflicting Boost descriptors fail before dispatch.
- [ ] Test Principal-only activation, bounded lease use, rollback, and audit behavior.
- [x] Run `npm run check`.
- [x] Run `npm test`.

## Documentation and Delivery

- [x] Update `docs/architecture.md` with a Mermaid dependency and configuration-flow diagram.
- [ ] Obtain independent review of the implementation and fitness assertions.
- [ ] Commit and push only after all quality gates pass.

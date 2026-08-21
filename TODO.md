# TODO: Shared Declarative Configuration Discovery for Boost

## Goal

Configure `pi-boost` through the same layered discovery convention used by Panopticon Teams without making Boost a team or creating cross-extension dependencies.

## Architecture

- [x] Draft ADR-047 for council review before implementation.
- [x] Identify the smallest extension-neutral discovery behavior currently in `extensions/pi-panopticon/teams/team-paths.ts`.
- [x] Extract neutral root discovery, path expansion, precedence, and descriptor enumeration into `lib/`.
- [x] Keep Team schemas, registry compilation, protocols, and execution inside `pi-panopticon`.
- [x] Keep Boost configuration validation, Principal authorization, lease, lifecycle, rollback, and audit inside `pi-boost`.
- [x] Make both extensions depend only on the shared `lib/` primitive, never on each other.
- [x] Do not add a bespoke `pi-boost/config.json` discovery path.

## Implementation

- [x] Refactor Panopticon Teams discovery to use the shared primitive without changing existing behavior.
- [x] Add a Boost-specific declarative configuration adapter using the shared discovery convention.
- [x] Define a minimal Boost descriptor containing only required provider/model and bounded runtime settings.
- [x] Connect the validated Boost descriptor to the existing lease-controlled dispatch path.
- [x] Preserve fail-closed behavior and leave the session default model unchanged.

## Review and Simplification

- [x] Complete lead F.I.R.E. review using Dan Ward's simplicity criteria.
- [x] Run repository static analysis over the affected architecture and implementation.
- [x] Fix every confirmed bug or document an explicit blocker.
- [x] Refactor and simplify the result using CLEAN, KISS, and DRY principles without introducing speculative abstractions.
- [x] Remove redundant configuration paths, duplicated discovery logic, dead code, and unnecessary indirection.
- [x] Re-run lead review after fixes to confirm that simplification preserved behavior and boundaries.

## Fitness and Tests

- [x] Assert that `pi-boost` and `pi-panopticon` do not import from each other.
- [x] Assert that shared discovery code contains no Team- or Boost-specific policy.
- [x] Assert that both extensions use the shared discovery primitive.
- [x] Assert that no bespoke Boost configuration fallback exists.
- [x] Test built-in, user, and project discovery precedence.
- [x] Add property-based tests for discovery precedence, path normalization, descriptor validation, bounded settings, and fail-closed inputs.
- [x] Record deterministic property-test seeds so failures are reproducible.
- [x] Test invalid, missing, and conflicting Boost descriptors fail before dispatch.
- [x] Test Principal-only activation, bounded lease use, rollback, and audit behavior.
- [x] Run `npm run check`.
- [x] Run `npm test`.

## Documentation and Delivery

- [x] Update `docs/architecture.md` with a Mermaid dependency and configuration-flow diagram.
- [x] Obtain delegated test and fitness review of the implementation and assertions.
- [x] Commit and push only after all quality gates pass.

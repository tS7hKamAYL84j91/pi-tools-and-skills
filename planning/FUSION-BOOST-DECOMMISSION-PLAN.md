# Plan: Decommission Fusion from Teams and Re-Integrate under pi-boost

## Status

Completed and integrated on 2026-08-21. ADR-050 accepted; Teams and Boost slices passed root and independent review.

## Objective

Decommission the stateless `fusion-analysis` protocol from the `pi-teams` extension, and re-implement it as an inline, resource-leased capability under `pi-boost`. This unifies the abstract "lease" and "yield" execution models for inline cognitive and environmental capability escalation.

## Non-Goals

- No changes to multi-agent stateful team protocols (`debate`, `consult`, `research`, `hierarchical-swarm`).
- No weakening of environmental lease/reversion controls; agent self-boost remains default-deny and requires trusted operator-authored standard Pi settings.
- No introduction of multi-process background agents under `pi-boost`.

---

## Decommission and Re-Integration Plan

### Milestone 1 — Authorize the Cognitive-Boost Architecture (ADR-050)

Draft and approve **ADR-050**, defining:
- The unified abstract boundary where both Environmental Boosts (tool/privilege leases) and Cognitive Boosts (semantic/parallel model leases) utilize the same lease/yield life cycle.
- The deprecation and removal of `fusion-analysis` from the `pi-teams` tools, commands, and tests.
- The new `/boost fusion` interface, parameters, and inline execution state.

**Validation command:**
```bash
npx vitest run tests/architecture && git diff --check
```

### Milestone 2 — Decommission Fusion from pi-teams

Remove all Fusion-related code and configuration from `pi-teams`:
- Delete `extensions/pi-teams/team-handler-fusion-analysis.ts`
- Delete `extensions/pi-teams/team-fusion-output.ts`
- Delete `extensions/pi-teams/team-fusion-planner.ts`
- Remove `fusionAnalysisHandler` from `extensions/pi-teams/team-handlers.ts`
- Delete `extensions/pi-teams/config/teams/fusion-analysis.md`
- Delete `tests/teams/team-fusion-handler.test.ts`
- Remove Fusion-specific checks from TUI renderers and benchmarks.

**Validation command:**
```bash
npx vitest run tests/teams tests/shared/extension-registration.test.ts
```

### Milestone 3 — Implement Cognitive Lease/Yield under pi-boost

Implement the parallel cognitive-boost pipeline in `pi-boost`:
- Add a `CognitiveLease` concept that models resource allocation for parallel panel models.
- Port the pure planners and output builders (the panel-selection and judge-synthesis logic) into `pi-boost/boost/cognitive.ts`.
- Execute panel queries concurrently and let the judge "yield" the final answer, releasing the model lease.
- Expose the cognitive boost as a registered `/boost fusion <prompt>` slash command and `boost_fusion` tool.

**Validation command:**
```bash
npx vitest run tests/boost tests/shared/extension-registration.test.ts
```

### Milestone 4 — Complete Full Validation and Quality Gates

Run all regression and integration suites to ensure the mono-repo remains perfectly clean:
- Verify that `pi-teams` works perfectly without any Fusion logic.
- Verify that `pi-boost` executes cognitive leases with precise resource limits and cleanup.
- Ensure strict quality gates (linting, type-safety, knip, type-coverage) pass completely.

**Validation command:**
```bash
npm run check && npm test
```

---

## Acceptance Criteria

- `pi-teams` contains zero code, configurations, or tests related to `fusion-analysis`.
- `pi-boost` successfully exposes a `boost_fusion` tool and `/boost fusion` command.
- A cognitive fusion boost leases panel resources concurrently, synthesizes the results via the judge, and yields the final answer in a single turn.
- Quality gates pass cleanly at 95%+ type coverage and zero knip/linter findings.

## Delivery evidence

- Teams decommission feature `026b94b`, merged as `f7e1742`; zero active Fusion residue fitness and full Teams/evals gates pass.
- Cognitive Boost feature `046a518`, merged as `fa2fbec`; trusted settings/capability, SettingsList, property/unit/integration/smoke, private audit, and lease lifecycle tests pass.
- Combined main: `npm run check` PASS at 99.24% type coverage; `npm test` PASS (187 files / 1,412 tests); focused architecture/Teams/Boost/evals/registration PASS (69 files / 565 tests).

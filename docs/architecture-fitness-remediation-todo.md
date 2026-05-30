# Architecture Fitness Remediation Goal

Date: 2026-05-30

## Goal

Remediate every actionable issue found in the 2026-05-30 architecture review so architecture fitness is enforceable, local file state is safe for multi-agent use, and runtime extension boundaries are explicit.

This goal is complete only when each review finding is either fixed with evidence, deliberately accepted with rationale, or marked out of scope with a follow-up owner/tracker.

Progress markers: `[ ]` Planned, `[~]` In progress, `[R]` Ready for review, `[x]` Done, `[!]` Blocked.

## Completion criteria

- `npm run check` passes in a freshly hydrated workspace.
- `npm test` passes, including `tests/architecture.test.ts` and `tests/test-quality.test.ts`.
- CI or equivalent documented automation runs the same fitness gates.
- State-writing code uses shared persistence helpers or has documented exceptions.
- Cross-extension code does not read, write, parse, or infer behavior from another extension's state files; it uses the owning extension's public runtime API instead, and a fitness test enforces this boundary.
- `lib/` layering is documented, and any enforceable dependency direction has a fitness test.
- Large/complex hotspot modules have either been responsibly split or documented as acceptable with a reason.

## Remediation goals

### AFR-001 — Restore architecture fitness enforcement `[R] Ready for review`

**Priority:** P0

**Finding:** During review, local `node_modules` did not expose `vitest`, so targeted architecture tests could not run even though the lockfile listed Vitest. Fitness tests also need automated enforcement, not just local intent.

**Goal:** Make architecture fitness checks reliably runnable in a freshly hydrated workspace and enforced by CI or an equivalent documented automation path.

**Done when:**

- `npm install` or equivalent dependency hydration restores `vitest` and all dev tools.
- `npm run check` passes locally.
- `npm test` passes locally, including architecture and test-quality suites.
- CI or equivalent documented automation runs namespace, typecheck, lint, knip, type-coverage, unit tests, and architecture tests.

**Evidence:** `package.json` declares Vitest and all local quality gates as dev dependencies. Local dependency hydration with `npm install` reports dependencies up to date and restores `node_modules/.bin/vitest`. `.github/workflows/fitness.yml` runs `npm ci`, `npm run check`, and `npm test` on push to `main` and pull requests. Local validation on 2026-05-30: `npm run check` passed; `npm test` passed with 71 files and 659 tests, including architecture and test-quality suites.

### AFR-002 — Standardize file persistence discipline `[ ] Planned`

**Priority:** P1

**Finding:** Local file-backed state uses mixed direct writes, append writes, and one-off atomic helpers across extensions.

**Goal:** Provide one boring, blessed persistence path for common state writes so multi-agent/local concurrent use is safer.

**Done when:**

- Shared helpers exist for atomic file writes.
- Shared helpers exist for append-only log writes.
- Shared helpers exist for safe JSON read/update/write cycles.
- State-owning extensions use those helpers or document explicit exceptions.
- Any locking/advisory-lock policy is documented where concurrent writers are possible.

### AFR-003 — Keep runtime coupling at extension APIs `[R] Ready for review`

**Priority:** P1

**Finding:** Static import boundaries do not expose runtime coupling through tools, commands, registries, transports, settings, files, and session events.

**Goal:** Enforce the simple rule in code: extension-owned state files are private, and cross-extension use must go through the owning extension's public runtime API.

**Done when:**

- Architecture docs state the boundary rule.
- Fitness tests fail if extension runtime code references another extension's private state markers.
- Existing code that reached into another extension's private state is moved behind a public/shared API.

**Evidence:** `tests/architecture.test.ts` now checks cross-extension private state markers. `pi-teams` self-lookup now uses `lib/agent-api.ts` instead of reading Panopticon registry files directly.

### AFR-004 — Clarify `lib/` layering `[ ] Planned`

**Priority:** P2

**Finding:** `lib/` mixes core-ish contracts, IO, runtime/session helpers, transports, TUI helpers, and research metadata.

**Goal:** Make `lib/` sub-boundaries explicit enough that future shared code has an obvious home and does not become a dumping ground.

**Done when:**

- `lib/` sublayers are documented, for example core, io, runtime, tui, and research.
- Intended dependency directions between sublayers are documented.
- Enforceable dependency-direction tests are added where practical.
- Non-enforceable guidance is clearly marked as guidance, not a fake gate.

### AFR-005 — Add richer architecture fitness checks `[~] In progress`

**Priority:** P2

**Finding:** Existing architecture checks are useful but lean heavily on import boundaries, line counts, and broad structural rules.

**Goal:** Add targeted checks for the architecture risks found in this review without creating brittle or noisy gates.

**Done when:**

- Cross-extension private-state marker checks are enforced. ✅ Done
- Direct state-write checks are added where they can be made accurate.
- Any exceptions for direct writes are explicit and reviewed.
- Complexity/module-responsibility checks are added only if they catch real drift without forcing artificial file splits.

**Evidence:** Cross-extension private-state contamination checks now live in `tests/architecture.test.ts`; broader direct state-write checks remain.

### AFR-006 — Manage complexity hotspots `[ ] Planned`

**Priority:** P2

**Finding:** Several extension files are near 400+ lines. They are not failures, but they are likely future complexity hotspots.

**Goal:** Prevent large modules from becoming hard-to-review God files while avoiding pointless line-count refactors.

**Done when:**

- Current hotspots are listed with a short keep/split rationale.
- Future work on hotspot files either preserves responsibility boundaries or extracts by stable responsibility.
- No file is split solely to satisfy a line count.
- Any accepted hotspot has a documented reason.

## Guardrails

- Do not reintroduce a generic `pi-teams` DAG/runtime unless multiple concrete protocols prove the need.
- Do not move files solely to satisfy line counts; extract around stable responsibilities.
- Keep local-first storage; the remediation goal is safer file discipline, not database adoption.
- Keep static import fitness tests, but treat them as necessary rather than sufficient.
- Keep the runtime dependency rule simple: no reaching into another extension's state files; use the extension API.

## Evidence from review

- Static architecture docs and tests show strong import boundaries and extension isolation.
- Local `node_modules` did not expose `vitest` during review, so validation trust depends on restoring dependency hydration and CI enforcement.
- Multiple extensions write local state directly or through one-off helpers, creating the main concurrency risk for multi-agent use.

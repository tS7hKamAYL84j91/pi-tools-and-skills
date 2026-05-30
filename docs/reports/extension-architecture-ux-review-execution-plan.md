# Extension Architecture and UX Review — Execution Plan

Date: 2026-05-28
Owner: pi-tools-and-skills repo worker

## Goal

Turn the architecture/UX review findings into a small, executable backlog for the extension suite without broad redesign.

## Current repo state

- Branch: `main`
- HEAD at review time: `5475238ae9225d9fce26309b680e60a82ee816c0`
- Working tree at inspection start: clean
- Extension READMEs present: `pi-coas`, `pi-goal`, `pi-kanban`, `pi-matrix`, `pi-research-tools`
- Extension READMEs missing: `pi-panopticon`, `pi-teams`
- Cross-extension TypeScript import isolation is already enforced in `tests/architecture.test.ts`.
- CoAS/Kanban scheduling boundary is documented in ADR 019 and reflected in docs/code.

## Key findings

### 1. Architecture is healthy; refine, do not redesign

The suite is broadly F.I.R.E.-aligned:

- Fast/inexpensive: local files and in-process extension surfaces dominate.
- Restrained: `pi-kanban` remains schedule-free; `pi-coas` owns recurrence/policy; `pi-research-tools` remains gated/dry-run for live providers.
- Elegant: shared library helpers and narrow extension packages keep most responsibilities clear.

Action: preserve current boundaries and avoid broad refactors.

### 2. Documentation boundaries are inconsistent

`docs/architecture.md` asks every README to include “What this does NOT do”, but current READMEs are inconsistent:

- Missing README entirely: `extensions/pi-panopticon`, `extensions/pi-teams`.
- Existing boundary prose but non-standard heading: `pi-research-tools` uses `## Boundaries`; `pi-goal` uses `## What this does not do`; `pi-matrix`, `pi-coas`, and `pi-kanban` contain boundary text but not the exact canonical heading.

Action: add/normalize extension README boundary sections.

### 3. Tool and command naming is mostly consistent, with Panopticon polish needed

Strong namespaces exist for `kanban_*`, `coas_*`, `team_*`, and `goal_*`. Panopticon has historically broader naming (`agent_*`, `message_*`, `spawn_agent`, `rpc_send`, `get_name`, `set_name`, `/send`, `/agents`, `/agent-list-mode`, `/agents-mode`).

Action: document the canonical Panopticon families first. Avoid breaking or renaming commands until a separate deprecation plan exists.

### 4. Kanban gradual disclosure is the best UX pattern

`kanban_snapshot` compact-by-default plus explicit `task_id`/`detail="full"` is the strongest model-context pattern in the suite.

Action: update `docs/ux-tools-policy.md` to promote this pattern suite-wide: compact default, explicit detail/full expansion, structured details for durable state.

### 5. Status/widget visibility works but naming conventions should be tighter

Status slots exist across extensions, but keys/labels vary:

- `goal`, `coas`, `pi-matrix`, `pi-kanban`, `agent-panopticon`, and `team` are used.
- `docs/ux-tools-policy.md` examples prefer visible labels such as `teams: ready`, `agents: ...`, `matrix: ...`.

Action: document current exceptions and only change runtime status keys if tests and UI review show no compatibility risk.

### 6. Error/result shape standardization should be incremental

Most extension tools return `{ content, details, isError? }`, but expected guard failures vary between thrown errors, `ok(...)` with result codes, and `fail(...)`.

Action: document a preferred convention first; only convert tools opportunistically with targeted tests.

### 7. `/goal` UX needs command discoverability and clearer cleanup controls

The current `pi-goal` README lists commands, but the interactive UX does not make it obvious which `/goal` subcommands are available during normal use. Operators should not have to remember whether the correct verb is `status`, `run`, `pause`, `resume`, `stop`, or `clear`.

Specific UX issue: clearing goals should be obvious and safe. The user should be able to clear goals with a discoverable command path, and the command should explain whether it clears only active goal state or also local runtime artifacts.

Action: include `pi-goal` in the execution backlog with:

- `/goal help` or equivalent command summary shown for unknown/empty usage;
- clearer `/goal clear` UX copy and confirmation/safety semantics where appropriate;
- README and command output parity so documented commands match what users can issue;
- tests for command help/unknown command/clear behavior.

## Proposed execution order

### Phase A — Documentation baseline (small/safe)

1. Add `extensions/pi-panopticon/README.md`.
2. Add `extensions/pi-teams/README.md`.
3. Add exact `## What this does NOT do` sections to all extension READMEs.
4. Update `docs/ux-tools-policy.md` with compact/detail disclosure and tool result conventions.
5. Add `pi-goal` command discoverability requirements to docs so `/goal` help/clear UX is explicit before implementation.

Validation:

- README/manual doc review.
- `npm run check` if docs-only changes are staged, because namespace/knip/type checks should remain clean.
- Navigator review.

### Phase B — Documentation enforcement (small test/docs)

1. Add a test that every `extensions/pi-*` package has `README.md`.
2. Add a test that every extension README contains `## What this does NOT do`.

Validation:

- Targeted test file.
- `npm run check`.
- `npm test`.

### Phase C — `/goal` UX cleanup (small implementation)

1. Make `/goal` with no args and `/goal help` display a concise command summary.
2. Make unknown `/goal` subcommands return the same summary plus the invalid verb.
3. Review `/goal clear` semantics and output so users know exactly what was cleared and what local files remain.
4. Add focused tests for help, unknown command, and clear behavior.

Validation:

- Targeted `pi-goal` command tests.
- `npm run check` and `npm test` if command behavior changes.

### Phase D — Panopticon UX cleanup plan (plan only unless approved)

1. Document canonical Panopticon tool/command families.
2. Identify duplicate/alias command candidates (`/agent-list-mode`, `/agents-mode`, `/send`).
3. Prepare a compatibility/deprecation plan; do not remove or rename commands without approval.

Validation:

- Docs review only unless implementation is approved.

### Phase E — Runtime polish follow-ups (defer unless separately approved)

Potential later items:

- status key normalization (`team` vs `teams`, `pi-matrix` visible label vs `matrix` example);
- incremental conversion of predictable guard failures to structured `fail(...)` or code-bearing details;
- concurrency/locking audit for kanban compaction and Matrix attachment writes.

## Execution status

Completed on 2026-05-28:

- Phase A documentation baseline is in place: every `extensions/pi-*` package has a README with the canonical `## What this does NOT do` boundary heading, including `pi-panopticon` and `pi-teams`.
- `docs/ux-tools-policy.md` documents compact-default tool output, explicit detail/full expansion, durable `details`, and structured guard-result conventions.
- Phase B guardrail exists in `tests/test-quality.test.ts`: shipped extensions must have README boundary documentation.
- Phase C `/goal` UX cleanup is implemented: `/goal` and `/goal help` show command help, unknown option-style commands show help without creating a goal, and `/goal clear` explains that local `.pi/goal/` state/run artifacts are removed.
- Panopticon canonical tool families are documented in `extensions/pi-panopticon/README.md`; no public commands were renamed or removed.

Validation evidence:

- `npm run test -- --run tests/test-quality.test.ts tests/pi-goal-tools.test.ts` passed: 2 files, 13 tests.
- `npm run check` passed: namespace, typecheck, lint, knip, and type-coverage at 99.27%.
- `npm test` passed: 62 files, 612 tests.
- Navigator review approved the docs/status-only completion change and flagged no blockers after final re-read audit.

## Recommended next action

The original Phase A through Phase C backlog is complete. Treat Phase D/E items as separate follow-up work requiring approval because they involve public command compatibility or runtime polish beyond this execution plan.

## Blockers / non-goals

- Do not rename/remove public commands in this goal.
- Do not change provider-backed research tool behavior.
- Do not alter CoAS/Kanban scheduling ownership.
- Do not mutate `working-notes`, `.workers`, secrets, or runtime board state.

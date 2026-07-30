# ADR 041: `/swarm` Direct Execution and File-Goal Delivery

## Status

Proposed — Principal sign-off required before implementation.

## Context

ADR-040 made `/swarm` and `swarm_*` compatibility aliases for the canonical `hierarchical-swarm-default` Teams path. The alias currently preserves a dry-run-first interaction: `/swarm <goal>` renders a transient preflight notification, while `--execute` starts a run.

The Principal has directed that dry-run be removed permanently. `/swarm <goal>` must start the canonical Teams swarm without an `--execute` split or a confirmation prompt.

The Principal also reports that `--execute` fails when a goal contains file references or attached files. This is potentially related to the prior Team child-process delivery defect resolved in `8bc3e7d`: prompts passed as process arguments could be truncated, misinterpreted, or lost, whereas stdin delivery with detached/non-TTY child support and `COAS_PI_LOCKFILE_CONTINUE=1` preserved stateless child execution. The root cause for `/swarm` has not yet been established; implementation must trace the actual `swarm` → Teams → node-runner path before applying a fix.

`/swarm status` and sibling query-command information disclosure are explicitly out of scope and require a separate audit.

## Decision

After Principal approval:

1. Remove dry-run from `/swarm` and `swarm_run` permanently.
   - Remove `dry_run` from `swarm_run` parameters.
   - Remove `--execute` parsing and the preflight notification path from `/swarm`.
   - `/swarm <goal>` and `swarm_run({ goal })` start `hierarchical-swarm-default` through the existing Teams facade.
   - No confirmation prompt is added.
2. Diagnose and correct file-bearing goal delivery on the canonical execution path.
   - Prompts, including file references/attached-file context, must reach root and child Team calls without argv transport, shell interpolation, or TTY dependence.
   - Reuse the proven stdin delivery pattern only if the trace confirms the same boundary; retain detached/non-TTY stdin handling and `COAS_PI_LOCKFILE_CONTINUE=1` where the stateless child runner requires it.
   - Do not introduce a separate `/swarm` process runner or a second lifecycle.
3. Add an end-to-end test that invokes `/swarm <goal-with-file-reference>` and proves the canonical Team handler receives the complete goal and file reference.
4. Update ADR-040, Teams/swarm documentation, command/tool schemas, and tests to state direct execution rather than dry-run-first behavior.

## Acceptance Criteria

- `/swarm <goal>` starts exactly one canonical Teams hierarchical-swarm run.
- `swarm_run({ goal })` starts the same canonical path; neither interface exposes dry-run or `--execute`.
- File-bearing goals are delivered intact to the Team root and any applicable child call without argv transport.
- Existing cancellation, status/list/stop, private-model eligibility, leaf no-spawn, and root-only lifecycle guarantees remain unchanged.
- The E2E file-goal test, `npm run check`, `npm test`, and `npm run security:semgrep` pass with no architecture-test exemptions.

## Consequences

- `/swarm` becomes an action command; callers requiring a plan must use Teams manifest/config inspection rather than a simulated execution path.
- Direct execution makes file-goal delivery a release blocker for this alias.
- The implementation may share the existing Team stdin runner but must not assume the reported defect has the same root cause until traced.

## Non-Decisions

- No `/swarm status` or sibling query-command disclosure audit or behavior change.
- No numeric hard caps, root-model changes, residency changes, or new confirmation UX.
- No changes to ADR-035 safety routing.

## Supersession

Upon acceptance and implementation, this ADR supersedes only ADR-040's dry-run compatibility language. ADR-040 remains the governing hierarchy, authority, capacity, and model-safety decision.

# T-310 pi-teams Worktree Isolation POC

Date: 2026-05-29
State: implemented as internal opt-in helper and tests only

## Summary

T-310 adds a minimal experimental helper for isolating mutating pi-teams worker work in dedicated git worktrees. It is not wired into `team_run`, does not change default team execution, and does not define a public runtime contract.

Artifacts:

- `extensions/pi-teams/worktree-isolation.ts` — internal planning/allocation/cleanup/conflict-reporting helpers.
- `tests/team-worktree-isolation.test.ts` — temp-repo tests for path planning, invalid inputs, allocation, cleanup, lock collision, dirty-main protection, and conflict reporting.

## Lifecycle model

1. **Plan** — derive deterministic branch, worktree, and lock paths from `runId` and `workerId`.
2. **Protect main checkout** — require `repoRoot` to be the git toplevel and `git status --porcelain` to be clean before allocation.
3. **Allocate** — create an atomic lock directory, then run `git worktree add -b <branch> <path> <baseRef>`.
4. **Run worker out of scope** — future team runtime may direct a mutating worker to the isolated path only after approval.
5. **Report conflicts** — inspect unmerged files with `git diff --name-only --diff-filter=U` inside the isolated worktree.
6. **Cleanup / rollback** — force-remove the worktree, delete the temporary branch, and remove the lock directory.

## Naming and collision handling

Default branch namespace:

```text
pi-teams/worker/<run-id>-<worker-id>
```

Default worktree directory name:

```text
<worktreeRoot>/<run-id>-<worker-id>
```

A sibling lock directory prevents duplicate allocation:

```text
<worktreeRoot>/<run-id>-<worker-id>.lock
```

`runId` and `workerId` are slugged and reject path separators/traversal. `worktreeRoot` must be an absolute path outside `repoRoot`, so linked worktrees do not dirty the main checkout as untracked files.

## Safety boundaries

- Opt-in helper only; not registered as a tool/command and not called by default runtime.
- Uses caller-provided explicit paths; no global worktree root or persistent registry.
- Test coverage uses temporary git repositories only.
- No live services, provider calls, credentials, keychain, session files, working-notes, `.workers`, or kanban state.
- Cleanup is destructive rollback for the isolated worker branch/worktree; callers must extract/merge desired changes before cleanup in any future approved integration.

## Verification

Implemented tests prove:

- deterministic path/branch/lock planning;
- invalid input rejection;
- allocation and cleanup lifecycle;
- collision lock rejection;
- dirty main checkout rejection;
- integration-style temp repo allocation where writing inside the isolated worktree leaves the main checkout clean;
- conflict reporting for unmerged files inside the isolated worktree.

Validation run:

- `npm run test -- --run tests/team-worktree-isolation.test.ts` passed: 1 file, 6 tests.
- `npm run check` passed: namespace, typecheck, lint, knip, type-coverage.
- `npm test` passed: 64 files, 624 tests.

## ADR disposition

No ADR is required for this POC because it is internal, opt-in, and not wired into public/default team execution or persistent state. ADR/reviewer approval is required before enabling worktree allocation from `team_run`, adding public tools/commands/config, defining persistent worktree storage semantics, changing cleanup policy, or automatically merging worker changes.

## Follow-up recommendations

- T-310A: design explicit runtime opt-in shape for mutating team roles, including when a team run may request isolation.
- T-310B: add a merge/report-only workflow that summarizes isolated worker diffs without applying them.
- T-310C: define operator approval gates for applying isolated worker changes back to the main checkout.
- T-310D: add stale lock/worktree cleanup policy before any long-running runtime integration.
- T-310E: harden future runtime promotion with realpath/symlink checks, explicit branch ownership metadata, and stricter base-ref validation before cleanup can delete branches automatically.

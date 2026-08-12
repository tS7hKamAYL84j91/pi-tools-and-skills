# T-817 — Autonomous quality gates (gate_command blocks completion until checks pass)

## Goal
Generalize the stop-and-fix verification pattern from T-797 (pi-goal) and T-802 (pi-kanban) into a reusable `gate_command` concept on three surfaces:
1. `extensions/pi-goal/goal-tools.ts` — `goal_complete` accepts an optional `gate_command`; if provided, it must exit 0 before the goal is marked complete.
2. `extensions/pi-kanban/complete-tool.ts` — `kanban_complete` accepts an optional `gate_command` alongside the existing `checks` field.
3. `extensions/pi-doctor/doctor.ts` — strict mode accepts `--gate <command>` that runs the gate before reporting PASS.

## In scope
- `gate_command` is opt-in; no-gate calls remain backward-compatible.
- If `gate_command` is provided, the tool runs it and checks `exit_code === 0`.
- Failed gate: return a bounded error message with the command output so the agent can repair and retry.
- Per-ticket opt-in (no global env flag required).
- Tests: gate-pass, gate-fail, no-gate backward compat.
- `npm run check` clean.

## Files to change
- `extensions/pi-goal/goal-tools.ts` — add `gate_command` parameter to `goal_complete`; execute gate if provided.
- `extensions/pi-kanban/complete-tool.ts` — add `gate_command` parameter; execute alongside existing checks logic.
- `extensions/pi-doctor/doctor.ts` — add `--gate <command>` strict-mode option and run gate before reporting.
- `tests/goal/pi-goal-gate-command.test.ts` — new tests.
- `tests/kanban/pi-kanban-gate-command.test.ts` — new tests.
- `tests/pi-doctor-gate.test.ts` — new tests.
- `briefs/2026-08-04-t817-autonomous-quality-gates.md` — this brief.

## Acceptance gates
- [ ] `goal_complete` with `gate_command` succeeds only when command exits 0.
- [ ] `kanban_complete` with `gate_command` succeeds only when command exits 0 (existing `checks` field still honored).
- [ ] `pi-doctor` with `--gate <command>` reports FAIL if gate exits non-0, PASS otherwise.
- [ ] No-gate behavior unchanged for all three surfaces.
- [ ] `npm run check` clean.
- [ ] Architecture tests green.

## Review plan
Navigator review before closing.

## Implementation status
TBD

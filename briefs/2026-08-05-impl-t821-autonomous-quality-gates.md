# T-821 — Autonomous quality gates implementation

## Goal
Add an optional `gate_command` to the three completion surfaces so a command must exit 0 before the completion event is written:
- `extensions/pi-goal/goal-tools.ts` — `goal_complete`
- `extensions/pi-kanban/complete-tool.ts` — `kanban_complete`
- `extensions/pi-doctor/doctor.ts` + `index.ts` — `pi-doctor` tool and `/pi-doctor` command

## Design
- New shared helper `lib/gate-command.ts` runs a shell command and returns a bounded `GateResult`.
- Gate output is capped at 2,000 characters; failures surface stderr first, then stdout, so the agent can repair and retry.
- All gates are opt-in; absence of `gate_command` keeps existing behavior unchanged.
- `pi-doctor` accepts `gateCommand` via tool param or `--gate <command>` on the slash command.

## Files changed
- `lib/gate-command.ts` — new shared runner.
- `extensions/pi-goal/goal-tools.ts` — `gate_command` param + gate check before completion.
- `extensions/pi-kanban/complete-tool.ts` — `gate_command` param + gate check after existing checks.
- `extensions/pi-doctor/doctor.ts` — `runDoctor(cwd, gateCommand?)` is now async; adds a gate finding.
- `extensions/pi-doctor/index.ts` — parses `--gate` from command args; exposes `gateCommand` tool param.
- `tests/architecture/lib-layering.ts` — classified `gate-command.ts` as an IO lib module.
- `tests/goal/pi-goal-gate-command.test.ts` — gate-pass / gate-fail / no-gate.
- `tests/kanban/pi-kanban-gate-command.test.ts` — gate-pass / gate-fail / no-gate.
- `tests/pi-doctor-gate.test.ts` — gate-pass / gate-fail / no-gate.
- `tests/pi-doctor-doctor.test.ts` — updated to `await runDoctor`.

## Validation
- `npm run check` clean.
- `npm test` — 148 passed, 1 skipped (T-823 test-first placeholder).
- Architecture tests green after adding `gate-command.ts` to `IO_LIB_FILES`.

## Review status
Ready for Navigator review (Gravitas-Pending).

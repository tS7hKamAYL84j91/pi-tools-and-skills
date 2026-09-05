# T-886 caller migration evidence

Status: active

Historical stage evidence; see `t-886-final-validation.md` for current status.

Date: 2026-09-05
Scope: corrected ADR-059 Slices 2–5 plus bounded caller-fix regressions; no owner/driver/watchdog admission wiring.

## Migration coverage

All production callers now use `transactGoal` through explicit expected-revision commit helpers; no production caller references `saveGoal` remain. Creation commits authority before generated artifacts and before appending a new binding. Conditional clear deletes only the authoritative state, confined projections, and recognized run artifacts, then unbinds only after the authority result. Callers thread the authoritative state returned by transactions and surface conflict/projection-failure outcomes without retrying.

The legacy `saveGoal` export remains only for existing test/fixture compatibility on this uncommitted migration branch. It is not a production fallback and remains a removal item before finalization.

## Regression-first evidence

A normal generated-artifact deletion regression was added before the source fix and executed RED:

```text
npx vitest run tests/goal/t-886-caller-migration-regressions.test.ts
7 tests: 1 failed
failure: removes normal generated run artifacts while preserving unknown contents
```

The failure reproduced the over-escaped matcher leaving `run-iter-001.jsonl` behind. The bounded TypeScript regex literal was then corrected to `/^[^/]+-iter-\d{3}\.(jsonl|md)$/`. The same focused caller/transaction/tools command is now GREEN:

```text
npx vitest run tests/goal/t-886-caller-migration-regressions.test.ts tests/goal/pi-goal-transaction.test.ts tests/goal/pi-goal-tools.test.ts
3 files passed, 42 tests passed, exit 0
```

The regression verifies recognized `.jsonl` and `.md` artifacts are removed while `attempt.jsonl` and unknown nested contents remain preserved. Unsafe symlink cleanup remains rejected.

Explicit bound-instance fail-closed tests now cover both a missing `goal.json` and invalid JSON. With a valid flat goal present, a missing bound instance resolves to `null`, a revision mutation returns `conflict`, and the flat goal is unchanged. Invalid bound JSON rejects both load and transaction and leaves the flat goal unchanged. These tests prove no fallback or cross-goal mutation.

## Historical whole-suite evidence

This report records caller-migration evidence only; ownership/admission is explicitly out of scope. At the time of this report, the whole goal suite still contained the intentionally deferred duplicate-driver failure:

```text
npx vitest run tests/goal
failure: prevents two independent drivers from steering one persisted goal (expected sends 1, received 2)
exit 1
```

No ownership conclusion is drawn from this historical run. Current ownership results are recorded separately in `docs/reports/t-886-ownership.md`.

## Diagnostic coverage investigation

Reviewed `formatGoalDiagnostic` and its current callers. It strips ANSI/control characters, redacts secrets, and bounds diagnostic length; projection/runtime failures use it. Existing projection-failure tests assert the discriminated failure outcome. This follow-up added no sanitizer behavior or broadening. Focused tests do not establish a universal no-raw-path/no-stack guarantee: direct filesystem errors in some creation/iteration paths can still escape the formatter. That remains an explicit diagnostic-coverage gap, not a claimed PASS.

## Independent re-review

Read-only Luna re-review verdict: **PASS**. It confirmed the literal TypeScript regex, regression sensitivity, bound-instance fail-closed coverage, and no owner/admission implementation. Source and tests are now frozen for this gate.

No commits, pushes, live goals, provider/config actions, or unrelated edits were performed. Existing dirty T-886 work was preserved.

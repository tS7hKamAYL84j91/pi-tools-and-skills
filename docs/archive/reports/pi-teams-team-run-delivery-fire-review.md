# FIRE Review — pi-teams team-run delivery repair

Date: 2026-07-27  
Target: working-notes issues #10 (lockfile-wrapper abort) and #12 (long-prompt empty team result)  
Baseline: `main` at `a429d1e`, clean before the repair  
Verdict: **PASS**

## Scope

- `lib/runtime-child-process.ts`
- `extensions/pi-panopticon/teams/runner.ts`
- Regression tests for child stdin, cancellation, and async public `team_run` follow-up delivery.

## Evidence

- The runner no longer places the user prompt in child argv. It supplies the prompt over a piped stdin stream and closes EOF.
- The child-process substrate preserves `/dev/null` stdin for callers without a payload, preserving existing behavior.
- Stateless `pi --print --no-session` children retain `COAS_PI_LOCKFILE_CONTINUE=1`; tests assert the child can observe it.
- Tests cover short and 16,000-character prompts, argv omission, exact stdin transfer, EOF, stderr separation, TTY-like parent state, cancellation, and async follow-up bodies for navigator and consultant consult teams.
- GM real-cli smoke test passed: a 16,000-character stdin prompt yielded the exact `TEAM-STDIN-SMOKE` response from `pi --print --mode json`.
- `npm run check`, `npm test`, and `git diff --check` passed. Architecture fitness passed with no exemptions.

## FIRE assessment

- **Fast**: avoids command-line prompt-size/interactive-mode sensitivity with one bounded stdin path; deterministic regression coverage gives fast feedback.
- **Inexpensive**: native Node child-process piping only; no dependency, service, persistence, or provider change.
- **Restrained**: no `team_run` schema, model-routing, review-verdict, or runtime policy change. The model-routing mismatch remains a separate diagnostic.
- **Elegant**: stdin behavior belongs in the shared child-process substrate; team protocol code only supplies its prompt.

## Follow-up

Investigate the reported navigator configured-model versus traced-model mismatch independently. It is intentionally excluded from this delivery repair.

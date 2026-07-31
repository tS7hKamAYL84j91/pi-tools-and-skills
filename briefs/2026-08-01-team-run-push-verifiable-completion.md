# T-805 — push-based, verifiable completion for team runs

## Goal
Close the T-803 delivery-loss class: a run must be marked `completed` **only** after the terminal result has been persisted to a claim-checkable on-disk artifact and the caller can reliably re-read it.

## Background
The navigator `team_run` was reported `completed` but unrecoverable from the message queue (`message_read` returned no unread). The current async path uses `deliverAs: "followUp"` passive delivery and records `completed` from memory. We need a completion-watcher pattern: write result to disk first, then (and only then) transition status to `completed`.

## In scope
1. Add a persistent, claim-checkable result artifact path under `COAS_HOME/team-results/{runId}.json` (or equivalent layout). Reuse T-801's atomic-write / constant-size / private-file discipline.
2. `runTeam` writes the terminal result to disk before it records the run as `completed`. If the write fails, the run stays `failed` or `running` — never `completed`.
3. `recordRunCompleted` remains the status transition, but the orchestrator must have written the artifact first and recorded its path/summary in the run record.
4. Provide a read-side helper for callers (and tests) to claim-check the artifact by run id.
5. Update `team-async.ts` so the follow-up message still fires for UX, but the source of truth is the artifact; if follow-up fails, status is still `completed` because the artifact is durable.
6. Add tests:
   - Failure-mode test: simulate a completed-status read that would have returned nothing; with the fix, either the artifact exists and is retrievable, or status is not `completed`.
   - Schema/status test: status transitions are `pending → running → completed`, and `completed` is reachable only after a successful artifact write.
   - Race test: artifact write happens before `run_completed` event.
   - Existing tests still pass.
7. `npm run check` clean; architecture tests green.

## Out of scope
- Persistent multi-turn child threads (#3 in diagnosis brief). Held until real evidence one-shot children still fail with T-803 + T-805 in place.
- Cross-repo changes to working-notes.

## Files to change
- `extensions/pi-panopticon/teams/types.ts` — optional `resultArtifactPath` on `TeamRunRecord`; optional result-artifact payload on completion event.
- `extensions/pi-panopticon/teams/team-result-artifact.ts` — new helper: `writeTeamRunResultArtifact(runId, result, coasHome)`, `readTeamRunResultArtifact(runId, coasHome)`, `teamRunResultArtifactPath(runId, coasHome)`.
- `extensions/pi-panopticon/teams/state.ts` — accept `resultArtifactPath` in `recordRunCompleted` and emit it on the event.
- `extensions/pi-panopticon/teams/team-runtime.ts` — in `runTeam`, write the artifact before calling `recordRunCompleted`; on failure record failed instead.
- `extensions/pi-panopticon/teams/team-async.ts` — keep follow-up but base it on the same artifact text.
- `tests/teams/team-run-push-verifiable-completion.test.ts` — new regression tests.
- `briefs/2026-08-01-team-run-push-verifiable-completion.md` — this brief.

## Acceptance gates
1. A terminal run result is persisted as JSON artifact at a stable path before `recordRunCompleted` is called.
2. `TeamRunRecord.status` is `completed` iff the artifact is readable on disk (modulo process races).
3. Simulated "parent reads completed run and gets nothing" is impossible: either status is not completed or `readTeamRunResultArtifact` returns the result.
4. Existing `team-runner-fork-turns` and other team tests still pass.
5. `npm run check` clean.
6. Architecture fitness tests green.

## Review plan
Navigator/Principal review before closing.

## Implementation status
- [x] `TeamRunRecord.resultArtifactPath` and `TeamRunResultArtifact` type added.
- [x] `team-result-artifact.ts` provides atomic write/read of bounded JSON artifacts under `{stateRoot}/team-results/{runId}.json`.
- [x] `team-run-completion.ts` owns the terminal completion sequence: write artifact first, then emit `run_completed`/`run_stopped`.
- [x] `team-runtime.ts` `runTeam` now calls `completeRun` before any status transition; `TeamRunToolResult` carries `runId`.
- [x] `team-async.ts` follow-up delivery prefers the durable artifact over the transient tool result.
- [x] Regression tests added for artifact-before-status, stopped artifacts, claim-check invariant, and simulated delivery loss.
- [x] Full validation: `npx vitest run` 143 files / 1066 tests, `npm run check` clean, architecture tests green.
- [x] Brief updated.

Note: one pre-existing T-801 continuation test flaked once during a full-suite run with an `ENOTEMPTY` temp-dir race; it passed on re-run and is unrelated to T-805.

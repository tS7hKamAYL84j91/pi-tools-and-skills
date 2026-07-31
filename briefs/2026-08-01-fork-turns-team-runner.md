# T-803 — fork_turns-equivalent for team runner

## Goal
Add a `fork_turns` field to the team runner spawn contract so a one-shot child can receive a bounded parent-context block as its first stdin content, ahead of the task prompt. This fixes the recurring cold-first-turn swarm failure diagnosed in `briefs/2026-08-01-codex-swarm-vs-ours-first-turn-diagnosis.md`.

## Background gap
`extensions/pi-panopticon/teams/runner.ts:195` passes only `args.prompt` via stdin. A `--print --no-session` child therefore starts with no parent context, so its first (and only) turn can be empty or no-op. Codex avoids this with `fork_turns`/`fork_mode` carrying parent history or summary into the child thread.

## In scope
1. Add `forkTurns?: ForkTurnsMode` to `GenerationConfig` and `RunModelArgs`.
   - Modes: `{ mode: "none" }` (default, no behavior change), `{ mode: "summary", summary: string }`, `{ mode: "lastN", turns: readonly unknown[], n: number }`.
2. Render the parent-context block as plain text and prepend it to the child's stdin, separated from the task prompt by a `---` delimiter.
3. **Constant-size guarantee**: summary is passed as-is (caller bounded); `lastN` uses exactly the last `n` turns; no historical-log accumulation.
4. Thread `forkTurns` through `runTeamNode` → `runRoleCall` → `runMember` → `runPiModel`.
5. Reuse T-801's bounded summary discipline (constant-size, claim-check, no history array) where natural.
6. Default `none` keeps existing behavior identical.
7. Tests for summary, lastN, none/default, and constant-size bound.
8. `npm run check` clean; architecture fitness tests green.

## Out of scope
- No persistent child threads / multi-turn child accumulation.
- No push-based completion delivery fix (separate from this cold-first-turn fix).
- No ADR change; this is a runner-level contract addition, not a tool-surface change.
- No cross-repo coupling to T-801; reuse is conceptual.

## Files to change
- `extensions/pi-panopticon/teams/types.ts` — add `ForkTurnsMode` and `forkTurns` to `GenerationConfig`.
- `extensions/pi-panopticon/teams/runner.ts` — add `forkTurns` to `RunModelArgs`; render and prepend context block in `runPiModel`.
- `extensions/pi-panopticon/teams/team-node-runner.ts` — propagate `forkTurns` from `runTeamNode` args through `runRoleCall` to `runMember`.
- `tests/teams/team-runner-fork-turns.test.ts` — new regression tests.
- `briefs/2026-08-01-fork-turns-team-runner.md` — this brief.

## Acceptance gates
1. `forkTurns: { mode: "summary", summary: "..." }` causes the child stdin to start with the summary block, then `---`, then the task prompt.
2. `forkTurns: { mode: "lastN", turns: [...], n: 3 }` causes the child stdin to start with the last 3 rendered turns, then `---`, then the task prompt.
3. Default/no `forkTurns` produces stdin identical to current behavior (only the task prompt).
4. Constant-size test: increasing the total number of parent turns does not increase the injected block length when `n` is fixed.
5. Existing team runner tests still pass.
6. `npm run check` clean.
7. Architecture fitness tests green.

## Review plan
Navigator review before closing.

## Implementation status
- [x] `ForkTurnsMode` type added to `GenerationConfig`.
- [x] Parent-context rendering and stdin prepending implemented in `runner.ts`.
- [x] `forkTurns` threaded through `runTeamNode` → `runRoleCall` → `runMember`.
- [x] Regression tests added for summary, lastN, none/default, and constant-size invariants.
- [x] Full validation: `npx vitest run` (142 files / 1062 tests), `npm run check` clean, architecture tests green.
- [x] Brief updated.

Note: one pre-existing T-801 continuation test flaked once with an `ENOTEMPTY` temp-dir race; it passed on re-run and is unrelated to this change.

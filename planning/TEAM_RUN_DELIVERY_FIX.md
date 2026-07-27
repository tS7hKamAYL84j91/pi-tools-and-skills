# Team-run delivery fix plan

## Goal

Fix `pi-teams` one-shot child execution so `team_run` returns completed text for short and long prompts, both synchronously and asynchronously.

## Evidence

- Working-notes issue #12: long (~3,500–3,800 token) inline prompt runs can return empty text and no useful async follow-up.
- Working-notes issue #10: a CoAS lockfile wrapper can silently abort `pi --print` child calls unless `COAS_PI_LOCKFILE_CONTINUE=1` is set.
- Current runner already sets `COAS_PI_LOCKFILE_CONTINUE=1`; preserve and regression-test it.
- Current runner passes the user prompt as a positional `pi --print` argument. `pi --print` accepts piped stdin when no positional user message is supplied.

## Target shape

```mermaid
sequenceDiagram
  participant Team as team runner
  participant Child as pi --print child
  participant Review as async follow-up

  Team->>Child: args: --print, --model, system prompt
  Team->>Child: stdin pipe: user prompt; then EOF
  Child-->>Team: stdout JSON/text
  Child-->>Team: stderr separately
  Team->>Team: extract final assistant text; reject empty success
  Team-->>Review: completed result for async calls
```

## Constraints

- No public `team_run` tool-schema or review-verdict change.
- No root-model, residency, cadence, or provider-routing change.
- No architecture-fitness exemptions; files stay below 300 lines.
- Preserve cancellation semantics and stdout/stderr separation.
- Keep lockfile continuation scoped to stateless `--print --no-session` child calls.
- Do not use Navigator/team_run to review this fix; use FIRE plus an independent reviewer.

## Implementation slices

1. **Child-process substrate**
   - Add optional stdin payload support to `spawnRuntimeChildProcess`.
   - Pipe/write/end only when a caller supplies input; retain `/dev/null` behavior otherwise.
   - Test payload delivery and cancellation.

2. **Team runner**
   - Remove user prompt from positional `pi` args.
   - Pass it through the runtime child-process stdin payload.
   - Retain `COAS_PI_LOCKFILE_CONTINUE=1` and test its child-visible value.
   - Preserve explicit stdout parsing and empty-success failure behavior.

3. **Regression tests**
   - Short and approximately 4,000-token (at least 16,000-character ASCII) prompt delivery.
   - Child sees prompt on stdin, not argv.
   - TTY-like parent environment does not alter delivery.
   - Lockfile continuation environment is present.
   - Existing synchronous runner and asynchronous `team_run` result paths retain non-empty result delivery; async test must capture the `sendUserMessage` follow-up body rather than only its start acknowledgement.
   - Cover consult/navigator routing through the common runner where practical.

4. **Validation and review**
   - `npm run check`, `npm test`, focused tests, and `git diff --check`.
   - FIRE review by an independent agent.
   - GM performs E2E acceptance: deterministic fake-child integration proves argv omission, exact stdin payload/EOF, stderr separation, lockfile-continuation environment, and follow-up body. A bounded real `pi --print` long-prompt smoke test is supplementary when credentials/config permit.
   - Secondary navigator-model mismatch is explicitly investigated as a separate, non-blocking diagnostic; no model-routing change belongs in this bug-fix patch.

## Acceptance criteria

- A 4,000-character prompt reaches the child via stdin and produces non-empty parsed text.
- No prompt text is supplied as the child positional message argument.
- `COAS_PI_LOCKFILE_CONTINUE=1` is visible to the child.
- Async completion sends a non-empty follow-up payload in the unit/integration harness.
- All quality gates pass without exemptions.

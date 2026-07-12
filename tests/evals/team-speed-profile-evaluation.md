# Team speed profile evaluation

Status: deterministic Phase 0 complete; live Phase 5 not run
Date: 2026-07-12

## Decision

Balanced remains the default team profile. Deterministic fixtures establish contract coverage but are not latency or provider-quality evidence. Fast may become the recommended profile only after the opt-in live gates below pass on the intended provider/model configuration.

## Phase 0: deterministic contract evaluation

`tests/evals/fixtures/team-speed-profiles.json` and `tests/evals/team-speed-profile-eval.test.ts` cover representative Fusion and Navigator behavior:

- route selection and supported topology;
- profile output, panel, timeout, retry, prompt, and history bounds;
- Fusion's complete judge-result schema and direct-answer behavior;
- degraded preservation of invalid Fusion output;
- direct Navigator output; and
- the deterministic rubric categories `routing`, `bounds`, `validity`, and `behavior`.

These tests run in normal CI and make no network or model calls.

## Phase 5: opt-in live benchmark

The live harness is excluded from `npm test` and `npm run check`. It invokes real configured providers only when both the command and opt-in environment variable are supplied:

```bash
PI_TEAM_LIVE_BENCHMARK=1 npm run benchmark:teams:live -- \
  --team fusion-analysis --profile balanced --runs 10 \
  --output ./tmp/fusion-balanced.json

PI_TEAM_LIVE_BENCHMARK=1 npm run benchmark:teams:live -- \
  --team fusion-analysis --profile fast --runs 10 \
  --output ./tmp/fusion-fast.json
```

Repeat the pair for `navigator`. `--model provider/model` may select the outer pi model; team-node models still come from the team configuration. The harness uses a fixed public prompt, does not accept credentials, and records neither prompts nor model output. Keep output paths outside version control and never benchmark private or secret-bearing content.

### Baseline record fields

Each JSON record contains:

- schema version, UTC generation time, repository commit, pi version, Node version, and platform;
- team, profile, run count, and optional outer model identifier;
- per run: exit status, end-to-end wall duration, persisted team duration, result-validity flag, failure category, and per-node role/model/success/duration;
- summary: successful/valid counts and median/P95 end-to-end and per-node durations.

Provider credentials remain environment-owned and are never serialized. Raw session files are deleted after timing extraction.

### Comparison method and promotion gates

Compare Fast with Balanced using the same machine, pi/repository revision, provider/model bindings, fixed prompt, and run count. Use at least 10 attempted runs per profile and report failures; do not discard retries, timeouts, or invalid results. Sort successful durations ascending. Median uses the midpoint (mean of the two middle values for an even sample); P95 uses nearest rank `ceil(0.95 × n)`.

Fast passes a topology's live gate only when:

1. at least 10 runs were attempted for both profiles;
2. routing is correct and all successful outputs satisfy the deterministic validity rubric;
3. Fast success and validity rates are no lower than Balanced;
4. Fast median end-to-end duration is at most 80% of Balanced; and
5. Fast P95 end-to-end duration is at most 90% of Balanced.

Both Fusion and Navigator must pass independently. Any provider/model/configuration change invalidates the comparison baseline. Until reviewed records satisfy every gate, Balanced remains the default and no speed, quality, or cost improvement should be claimed.

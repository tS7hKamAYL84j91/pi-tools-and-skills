# Team speed profile evaluation

Status: deterministic Phase 0 complete.
Date: 2026-07-12

## Decision

Balanced remains the default team profile. Deterministic fixtures establish contract coverage but are not latency or provider-quality evidence. Fast may become the recommended profile only after the opt-in live gates below pass on the intended provider/model configuration.

## Phase 0: deterministic contract evaluation

`tests/evals/fixtures/team-speed-profiles.json` and `tests/evals/team-speed-profile-eval.test.ts` cover representative Navigator behavior:

- route selection and supported topology;
- profile output, timeout, retry, prompt, and history bounds;
- direct Navigator output; and
- the deterministic rubric categories `routing`, `bounds`, `validity`, and `behavior`.

These tests run in normal CI and make no network or model calls.

## Phase 5: opt-in live benchmark

The live harness is excluded from `npm test` and `npm run check`. It invokes real configured providers only when both the command and opt-in environment variable are supplied:

```bash
PI_TEAM_LIVE_BENCHMARK=1 npm run benchmark:teams:live -- \
  --team navigator --profile balanced --runs 10 \
  --output ./tmp/navigator-balanced.json

PI_TEAM_LIVE_BENCHMARK=1 npm run benchmark:teams:live -- \
  --team navigator --profile fast --runs 10 \
  --output ./tmp/navigator-fast.json
```

`--model provider/model` may select the outer pi model; team-node models still come from the team configuration. The harness uses a fixed public prompt, does not accept credentials, and records neither prompts nor model output. Keep output paths outside version control and never benchmark private or secret-bearing content.

### Baseline record fields

Each JSON record contains:

- schema version, UTC generation time, repository commit, pi version, Node version, and platform;
- team, profile, run count, and optional outer model identifier;
- per run: exit status, end-to-end wall duration, persisted team duration, exactly-one matching route flag, schema-valid flag, judge-valid flag, degraded flag, result-valid (schema-valid AND non-degraded) flag, failure category, and per-node role/model/success/duration/redacted-error-category;
- summary: successful/schema-valid/degraded/non-degraded/judge-valid counts, per-role/model success and error-category totals, and median/P95 end-to-end and per-node durations for both all-completed and non-degraded-only runs.

Provider credentials remain environment-owned and are never serialized. Raw session files are deleted after timing extraction. Raw node error strings are never persisted; only bounded redacted error categories are recorded.

### Comparison method and promotion gates

Compare Fast with Balanced using the same machine, pi/repository revision, provider/model bindings, fixed prompt, and run count. Use at least 10 attempted runs per profile and report failures; do not discard retries, timeouts, or invalid results. Sort successful durations ascending. Median uses the midpoint (mean of the two middle values for an even sample); P95 uses nearest rank `ceil(0.95 × n)`.

Fast passes a topology's live gate only when:

1. at least 10 runs were attempted for both profiles;
2. routing is correct and all successful outputs satisfy the deterministic validity rubric;
3. the Balanced baseline is healthy: Balanced non-degraded runs are at least 80%, Balanced per-model node success is at least 80%, and no model exceeds a 20% failure rate;
4. Fast non-degraded validity is at least Balanced non-degraded validity;
5. Navigator Fast median end-to-end duration is at most 60% of Balanced and P95 is at most 30 seconds; and
6. no single model has a node failure rate above 20% in either profile.

Any provider/model/configuration change invalidates the comparison baseline. Until reviewed records satisfy every gate, Balanced remains the default and no speed, quality, or cost improvement should be claimed.

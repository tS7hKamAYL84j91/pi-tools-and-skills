# Benchmarks

Evaluation-only runners live here. They are excluded from the published Pi
package (`package.json`'s `files` allowlist) and never imported by runtime code.
Installation and maintenance utilities stay in `scripts/`.

| Runner | Entry point | Live opt-in | Guide |
| --- | --- | --- | --- |
| Goal | `npm run benchmark:goal -- ...` | `--execute`; default is dry-run | [Goal](goal.md) |
| Team Workflows | `npm run benchmark:teams:live -- ...` | `PI_TEAM_LIVE_BENCHMARK=1` plus explicit CLI arguments | [Team Workflows](teams.md) |

The npm entry points and their arguments are unchanged. Direct script paths
moved from `scripts/` to `benchmarks/`; Python helpers now use the `benchmarks`
package. `goal-benchmark-verify.py` is a benchmark-only trusted bundle verifier,
not an operator verifier automatically installed into Goal.

## Offline checks

```sh
npm test -- tests/evals
python3 -B tests/evals/goal_benchmark_test.py
```

Offline tests stay in `tests/evals/` and run under normal `npm test`: frozen
fixtures, synthetic results and fake RPC children, never live providers.
Goal retains original private trial sessions; Team Workflows extracts redacted
timing and discards its temporary raw sessions. These distinct evidence policies
remain unchanged. Never commit private outputs or change model/profile defaults
as part of a benchmark move. Passing an experiment is not live operational
completion or proof of general superiority.

# Deterministic Evaluation Harness

This directory contains deterministic evaluation fixtures for tools, skills, team protocols, and team speed-profile contracts. It runs in CI without live LLM or network calls.

## Scope

- **Tool executions:** output bounds, false triggers, parameter handling, and adversarial resilience.
- **Team protocols:** routing for Navigator, council, and deep-research built-ins.
- **Speed profiles:** representative Navigator routing, bounds, result validity, and direct result behavior.

## Adding tests

1. Add fixtures simulating LLM output or user input.
2. Keep assertions completely deterministic.
3. Update a fixture only for an approved contract-baseline change.

Live provider timing is deliberately separate. See `tests/evals/team-speed-profile-evaluation.md` and the explicitly opt-in `npm run benchmark:teams:live` command. Live results are not CI evidence and must not contain prompts, outputs, credentials, or private session data.

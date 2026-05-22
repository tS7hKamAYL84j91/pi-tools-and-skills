# T-501 Local Oracle-Judge POC

Date: 2026-05-22

## Summary

T-501 adds a small local/non-production oracle-judge POC inspired by AutoBeta/oracle-judge evaluation patterns. It combines synthetic judge criteria into one deterministic verdict for fixture-driven experiments.

Artifacts:

- `lib/oracle-judge.ts` — deterministic weighted-score combiner.
- `tests/oracle-judge.test.ts` — synthetic fixture, threshold, invalid-shape, and determinism tests.

## Contract

Input:

- `id`
- `judges[]` with `criterion`, `score` from 0 to 1, optional positive `weight`, and `reason`
- optional `passThreshold` and `warnThreshold`

Output:

- `verdict`: `pass | warn | fail`
- weighted `score`, `maxScore`, `normalized`
- expanded criteria with effective weights
- human-readable reasons

The result is deterministic and local. There are no model calls, network calls, external repository reads, settings mutations, or extension discovery wiring.

## Relationship to T-193 / AutoBeta pattern

This is a narrowed local successor to the broader T-193 idea. It borrows only the useful pattern of multiple judges/criteria producing a single deterministic aggregate result. It does **not** clone AutoBeta, run setup scripts, modify `~/.pi`, add providers, or integrate with production workflows.

## Promotion gates

Before promotion, require a new review/ADR if any of these are proposed:

- model-backed judges;
- public/durable result schema;
- extension/tool registration;
- recurring eval workflow;
- external repo integration;
- use on live/private user data.

## ADR disposition

No ADR is needed for this local fixture-only POC. ADR required before production wiring, recurring eval workflows, public schema, model-backed judges, or external integration.

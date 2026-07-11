# Deterministic Evaluation Harness

This directory contains the deterministic evaluation harness for tools, skills, and team protocols. 

It is designed to run in CI without live LLM or network calls.

## Scope
*   **Tool Executions:** Verify output bounds, false triggers, parameter handling, and adversarial resilience (path traversal, prompt injection proxies, oversize limits).
*   **Team Protocols:** Verify correct routing for navigator, council, fusion, and deep-research built-in protocols.

## Adding Tests
1. Add fixtures simulating LLM output or user input.
2. Ensure assertions are completely deterministic.
3. If an intentional change breaks a fixture, update the fixture to reflect the new approved baseline.

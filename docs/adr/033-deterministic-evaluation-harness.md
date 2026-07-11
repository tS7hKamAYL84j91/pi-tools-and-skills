# ADR 033: Deterministic Evaluation Harness

## Context
As the complexity of tools, skills, and team protocols (navigator, council, fusion, deep-research) grows, ensuring behavioral correctness becomes difficult. Traditional testing against live LLMs in CI is slow, non-deterministic (flaky), expensive, and vulnerable to model drift. We need a way to confidently assess regressions in tool selection, adherence proxies, false triggers, bounds, and adversarial resilience without making live network or model calls. 

## Decision
We will build a deterministic, static evaluation harness in `tests/evals/` that runs during CI, separate from any nightly provider/model-dependent semantic evaluations.

1. **Versioned Fixtures:** Evaluation scenarios will be captured in versioned JSON/TypeScript fixtures.
2. **Deterministic CI Evaluation:** The harness will inject static payloads (e.g., tool calls, agent messages) into the routing, tool execution, and boundary logic to evaluate behavior deterministically. No live LLM calls or private sessions will be used.
3. **Evaluation Dimensions:** 
   - Proxies for tool/skill selection and task adherence.
   - Rejection of false triggers and unnecessary calls.
   - Enforcement of output bounds.
   - Resilience against adversarial cases (prompt-injection, path-traversal, oversized payloads).
   - Correct protocol routing for built-in teams (navigator, council, fusion, deep-research).
4. **Regression Budgets & Intentional Changes:** CI deterministic tests must maintain a 100% passing rate (budget = 0 regressions allowed). Intentional changes in behavior require updating the versioned fixtures, serving as an explicit approval of the new behavior.
5. **Separation of Concerns:** Semantic model quality and provider-specific quirks are excluded from this static harness. They belong in a separate, optional nightly execution that logs metadata.

## Consequences
- **Pros:** CI remains blazingly fast and completely deterministic. Refactoring tool or routing logic provides immediate, reliable feedback. Security boundaries (adversarial/path cases) are explicitly enforced and documented.
- **Cons:** We are evaluating the *system's* handling of assumed LLM outputs, not the LLM's ability to produce them. Semantic regressions in how a model behaves will not be caught in CI.

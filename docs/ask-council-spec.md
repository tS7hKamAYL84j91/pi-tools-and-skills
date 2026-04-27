# ask_council Pair & Debate Spec

Date: 2026-04-25

Status: draft

## Purpose

Add a council-oriented orchestration tool that supports two distinct workflows:

- **PAIR-CODING** — the human-facing label for a bounded dyadic Driver/Navigator loop for code work.
- **COUNCIL** — the human-facing label for a multi-model exploration/synthesis loop for reasoning and strategy.

Internally, the tool may still use `PAIR` and `DEBATE` as mode values. The design goal is low churn, clear boundaries, and predictable behavior.

## Guiding principles

- Keep the modes conceptually separate.
- Use role-based model routing, not hardcoded model IDs in the public API.
- Keep context loading explicit and deterministic.
- Default to read-only behavior.
- Expose phase status and structured results.
- Bound the loop count; do not create open-ended auto-repair.

## Public API shape

The tool should accept an object-shaped request, not a positional string-only API.

```ts
interface AskCouncilInput {
  prompt: string;
  mode: "PAIR" | "DEBATE";
  files?: string[];
  specPath?: string;
  write?: boolean;
  requireApproval?: boolean;
  models?: {
    driver?: string;
    navigator?: string;
    chairman?: string;
    debaters?: string[];
    reviewers?: string[];
  };
  limits?: {
    maxFixPasses?: number;
    maxDebaters?: number;
    maxReviewers?: number;
    timeoutMs?: number;
    tokenBudget?: number;
  };
}
```

### MVP subset

For the first implementation, support at least:

- `prompt`
- `mode`
- `files`
- `specPath`
- `write`
- `models.driver`
- `models.navigator`
- `limits.maxFixPasses`
- `limits.timeoutMs`
- `limits.tokenBudget`

The schema should leave room for `DEBATE` even if `PAIR` lands first.

## Mode A: `PAIR-CODING` (`PAIR` internally)

### Intent

A bounded Review-then-Fix loop for coding tasks.

### Workflow

1. **Prepare context**
   - Discover project root.
   - Load project instructions.
   - Load `specPath` if provided, otherwise discover the nearest applicable spec.
   - Load any explicit files.

2. **Navigator alignment**
   - Navigator checks the prompt for ambiguity.
   - If the task is underspecified, return a concise clarification request or a scoped assumption set.

3. **Driver implementation**
   - Driver generates code or a patch.
   - Driver works from the aligned brief and loaded context.

4. **Navigator review**
   - Navigator reviews the artifact or diff.
   - Feedback must be concrete: bugs, missing requirements, boundary violations, or test gaps.

5. **Driver fix pass**
   - Driver receives the review.
   - Apply at most one fix pass by default.

6. **Complete**
   - Return the final summary, diffs/changed files, warnings, and any residual issues.

### Pair mode constraints

- Default to `write: false`.
- If writes are enabled, require explicit approval.
- Default fix passes: `1`.
- Do not loop indefinitely.
- Keep the Driver and Navigator context isolated; only share explicit artifacts.

## Mode B: `COUNCIL` (`DEBATE` internally)

### Intent

Use multiple heterogeneous models to explore a question, then synthesize the result.

### Workflow

1. Prepare context.
2. Generate independent candidate responses.
3. Strip explicit model/agent identity from peer review inputs.
4. Run peer review.
5. Chairman synthesizes consensus and disagreements.
6. Return a structured summary.

### Debate mode constraints

- Read-only by default.
- Bound the number of debaters and reviewers.
- Expose disagreement clearly.
- Report budget or timeout failures explicitly.

## Model routing

Use capability-based roles rather than fixed model IDs in the spec.

Suggested roles:

- **Driver** — preferred coding model
- **Navigator** — preferred reasoning/review model
- **Chairman** — preferred synthesis model
- **Debaters** — diverse models for initial answers
- **Reviewers** — models used for critique

Concrete model selection should live in pi routing/config, not hardcoded in the public API.

## Context loading rules

The spec loader should be deterministic.

### Default order

1. Discover project root by walking upward from the current working directory.
2. Load the nearest applicable `AGENTS.md` if present.
3. If `specPath` is provided, load it.
4. Otherwise try `spec.md` and then `docs/spec.md`.
5. Load explicit `files[]` after the spec context.

### Rules

- Ignore binary files.
- Avoid obvious secret files by default.
- Enforce size limits.
- Report every loaded file in the result.
- If no spec file exists, continue with a warning rather than failing.

## Context isolation

The feature should promise **conversation/session isolation**, not filesystem sandboxing.

That means:

- each role gets its own prompt/session context;
- only explicit artifacts are shared between roles;
- the orchestrator owns the handoff between Driver and Navigator;
- shared workspace state must be treated as shared state unless a sandbox is introduced later.

## Result shape

The tool should return structured output, not a plain string.

At minimum:

- final summary
- mode
- phase metadata
- loaded context list
- warnings
- model fallback information
- errors or cancellation state
- changed files or diff for `PAIR`
- candidate/review/synthesis data for `DEBATE`

## UI status

The UI should reflect phase-level progress and use human-facing labels in status text where practical.

### `PAIR-CODING`

- preparing context
- navigator brief
- driver implementation
- navigator review
- driver fix pass
- complete

### `COUNCIL`

- preparing context
- collecting independent answers
- anonymized peer review
- chairman synthesis
- complete

## Safety defaults

- `write: false` by default.
- `requireApproval: true` when `write: true`.
- Bounded fix passes.
- Budget and timeout limits required in practice.
- No hidden autonomous loops.

## Implementation order

Recommended order:

1. Preserve the existing `DEBATE` behavior as the baseline.
2. Add the object-shaped request/result contract.
3. Implement `PAIR` first.
4. Add context loading and phase status.
5. Add safe write/approval behavior.
6. Document the final behavior.

## Acceptance criteria

The feature is ready when:

- `PAIR` can run a bounded review-then-fix cycle.
- `DEBATE` can run a bounded synthesize-and-review cycle.
- Context loading is deterministic and reported.
- Phase status is visible.
- Write behavior is opt-in.
- Results are structured.
- Existing repo invariants remain unchanged.

## Non-goals for v1

- Open-ended self-healing loops
- Filesystem sandboxing of agents
- Perfect anonymity guarantees
- Hardcoded public model IDs
- Broad repo refactors unrelated to council orchestration
- Reworking the already-shipped `DEBATE` workflow unless a bug forces it

## Notes

This spec intentionally separates the reasoning workflow (`COUNCIL` / `DEBATE`) from the coding workflow (`PAIR-CODING` / `PAIR`). The implementation should not confuse the two just because they share orchestration primitives.

---
name: pi-team-consultation
description: Use pi declarative teams for review and decision support. Trigger when work needs llm-council, navigator, council review, architecture review, strategy debate, lightweight review, or a second opinion via team_run.
---

# Pi Team Consultation

Use this skill to decide when and how to call the built-in `llm-council` and `navigator` teams.

## Decision checklist

Before choosing a reviewer, answer these:

1. Does this change remove or add a public API, tool, or command? → `llm-council`
2. Does this change affect architecture boundaries, handler interfaces, type schemas, persistence, or extension isolation? → `llm-council`
3. Does this change affect 3+ files across 2+ extensions? → `llm-council` or `navigator`
4. Is this a focused correctness, scope, test, or docs check on a bounded diff? → `navigator`
5. Is this a small local implementation review or explicitly requested peer review? → `gravitas`
6. Is this a trivial edit with green tests and no policy impact? → self-review is enough

If multiple answers point to `llm-council`, use it. Do not downgrade architecture or public-surface decisions to `gravitas` just to save time.

## Invocation rule

Invoke teams with `team_run`, and default to `async: true` so the main agent can keep working while the result arrives as a follow-up message.

Use synchronous `team_run` only when the next step cannot proceed without the result. Inspect active team runs with `runtime_status`; stop them with `runtime_stop` unless a user explicitly asks for the older `team_runs`/`team_stop` names.

## Routing

Use `team_run` with `id="navigator"` and `async: true` for lightweight focused review:
- before finalizing a non-trivial but local change
- when checking correctness, scope, tests, docs, or edge cases
- when a single skeptical reviewer is enough
- when the prompt can be answered from a compact diff, file list, or design note

Use `team_run` with `id="llm-council"` and `async: true` for high-impact or contentious decisions:
- architecture changes or broad refactors
- tool/API surface changes
- security, policy, persistence, or cross-repo decisions
- ambiguous product direction where disagreement is valuable
- choices that should produce tradeoffs, not just approval

Prefer a direct peer review, such as `gravitas`, when the request explicitly asks for that peer or when the change is small and already well scoped.

## Formal vs informal review

Use `agent_send` to a peer agent for quick conversational review:
- small scope checks
- "does this look right?" questions
- follow-up on a specific diff or test result

Use async `team_run` for structured review:
- architecture decisions
- policy choices
- public tool/API changes
- design disputes
- anything needing a report or paper trail

When in doubt, use `team_run` with `async: true`; structured output is easier to act on and reference later.

## Prompt shape

Give teams enough context to disagree productively without dumping the whole repo.

Include:
1. **Decision or review ask** — one clear question.
2. **Changed files or relevant modules** — paths and short summaries.
3. **Constraints** — compatibility, behavior preservation, validation gates, policy decisions.
4. **Evidence** — diff summary, test output, known risks, prior decisions.
5. **Expected output** — approve/block, ranked options, risks, or concrete fixes.

## Navigator pattern

Use for focused review:

```ts
team_run({
  id: "navigator",
  async: true,
  prompt: "Review this focused change for correctness and scope.\n\nChanged files:\n- ...\n\nValidation:\n- npm run check passed\n- npm test passed\n\nPlease flag behavior drift, missing tests, or overreach.",
});
```

Act on feedback in a tight loop. If the navigator raises a design dispute rather than an implementation nit, escalate to `llm-council`.

## LLM Council pattern

Use for architecture or strategy:

```ts
team_run({
  id: "llm-council",
  async: true,
  prompt: "We need to decide ...\n\nOptions:\nA) ...\nB) ...\n\nConstraints:\n- ...\n\nAsk: debate the options, identify hidden risks, and recommend one path with consequences.",
});
```

Ask for disagreement explicitly. Good council prompts request tradeoffs, failure modes, and a final recommendation. For `llm-council`, include: "Please disagree if any option is bad, and explain tradeoffs."

## Escalation rules

- If the decision creates or removes public API, run `llm-council`.
- If the decision changes architecture boundaries, run `llm-council` and record an ADR when accepted.
- If it is a local implementation review, run `navigator` or peer-review with `gravitas`.
- If the team result is ambiguous, choose the smallest reversible step and document the assumption.

## Anti-patterns

- Do not use council as a rubber stamp for trivial edits.
- Do not send huge raw logs when a concise summary and file paths suffice.
- Do not block on user approval when project TODOs authorize team/council escalation.
- Do not resurrect removed generic graph/topology abstractions; current teams use direct handlers.

## History notes

This repo renamed `default-debate` to `llm-council`, renamed `consult` to `navigator`, removed pair-coding topology, and deleted the generic DAG/lowering layers. See [history notes](references/history.md) for commit pointers and rationale.

---
name: pi-team-consultation
description: Use pi declarative teams when an independent review, contested decision, or sourced research would materially help, or when the user requests a second opinion via team_run.
---

# Pi Team Consultation

Do the work and self-check first. Teams are optional assistance, not approval
steps. File count, public API changes, or architecture work alone do not require
a team, escalation, or an ADR. Respect explicit project safety and approval gates.

## Choosing help

- **Self-review:** the default for work you can assess directly.
- **Navigator:** a bounded second opinion when a skeptical reviewer would help.
- **LLM Council:** exceptional unresolved tradeoffs where multiple independent
  views are worth the cost, or an explicit user request. Not a routine review step.
- **Deep Research:** only for sourced research that needs evidence gathering and
  independent verification loops.

Use the smallest sufficient option. A review disagreement is something to
investigate, not an automatic escalation. Ask the user only when a genuine
requirement, permission, or risk decision needs their input. A team cannot grant
permissions or override configured gates.

## Invocation

Use `team_run`; prefer `async: true` when useful work can continue while it runs.
Use a synchronous call when the next step depends on the answer. Bound the scope,
timeout, and retries. Inspect runs with `team_runs` (optional `runId` for one run)
and cancel with `team_stop`. These read and change the same session-backed state.
For human commands, use `/teams run`, `/teams async`, `/teams status`, and `/teams stop`.

```ts
team_run({
  id: "navigator",
  async: true,
  limits: { timeoutMs: 90000, maxRetries: 0 },
  prompt: "Review this focused change for correctness and scope. Changed files: ... Checks: ... Flag concrete bugs, missing tests, or unnecessary complexity. Do not edit files.",
});
```

## Useful review requests

Provide one question, relevant paths or a compact diff, constraints, and observed
check results. Ask for concrete findings or ranked options, not a rubber stamp.
Avoid raw logs, private transcripts, secrets, and large pasted context.

Evaluate feedback against the code and tests. Fix demonstrated problems and
report remaining uncertainty. Do not add status relays, repeat reviews until
reviewers agree, or create documents just to leave a paper trail.

Historical context is in [history notes](references/history.md); it does not
prescribe a workflow for current work.

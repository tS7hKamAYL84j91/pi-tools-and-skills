# Team consultation history

Useful archaeology points for why this skill routes to `llm-council` and `navigator`.

## Current direction

- Teams are direct protocol handlers, not a generic workflow framework.
- Built-ins are user-facing team ids:
  - `llm-council` — debate protocol for high-stakes multi-model disagreement.
  - `navigator` — consult protocol for focused single-reviewer feedback.
- Live peer bindings are explicit `agent:<registered-name>` references.
- Future teams work is evidence-gated; do not add new topology machinery without a concrete workflow gap.

## Git history pointers

Run these from the repo root for context:

```bash
git show --stat 11436c9  # rename default-debate -> llm-council; drop pair-coding
git show --stat f5a8ad3  # rename consult -> navigator
git show --stat 0794d1f  # simplify direct protocol handlers; delete graph/lowering
git show --stat d949187  # finalize direct topology cleanup
git show --stat b14979a  # close LangGraph evaluation
```

## Rationale distilled

- Use `navigator` when one focused skeptical review is enough.
- Use `llm-council` when disagreement is the point.
- Keep prompts compact and decision-oriented.
- Record accepted high-impact decisions as ADRs.

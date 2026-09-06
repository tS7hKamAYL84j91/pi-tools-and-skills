---
name: fire-review
description: Dan Ward F.I.R.E. repo/codebase review skill. Use for a FIRE review, Fast/Inexpensive/Restrained/Elegant assessment, or evidence-backed release-readiness review.
---

# FIRE Review

Review the requested scope for useful simplification and concrete risks.
F.I.R.E. means **Fast** to understand and validate, **Inexpensive** to maintain,
**Restrained** in scope, and **Elegant** in composition. These are lenses for
judgment, not four mandatory reports.

## Triggers

Use for a FIRE review, codebase simplification assessment, or a requested
release-readiness verdict.

## Guardrails

- Stay within the assigned repo and scope. Do not read secrets, keychains, raw
  session logs, private scratch, ignored auth files, or excluded state.
- Preserve uncommitted work and session history. Do not mutate code during a
  review unless the user asks for fixes.
- Prefer current code and checks; historical reports are optional context, not
  authorities or prerequisites.
- Do not invent results or imply unchecked areas are safe.
- Preserve configured safety and approval gates. Neither review consensus nor
  a document grants permission.

## Workflow

Inspect git status, relevant source, callers, tests, and package metadata. Follow
promising findings with bounded checks or reproductions. Rank concrete problems
and explain the smallest useful improvement. Self-review the findings; use an
independent reviewer only if it materially helps.

Do not require planning documents, board updates, escalation chains, or a saved
report. Ask the user only when a genuine scope, permission, or safety decision
prevents progress.

## Evidence checklist

Include what supports the findings: file/line references, observed behavior,
check results, and relevant limitations. Distinguish reproduced problems from
suspicions. Separate correctness risks from optional cleanup. Omit irrelevant
categories rather than filling a template.

## Verdict semantics

If a release verdict is requested, use:

- **PASS** — no release blocker found within the checked scope.
- **PASS with follow-ups** — shippable with non-blocking improvements.
- **CONDITIONAL PASS** — shippable only after stated, verifiable conditions.
- **BLOCKED** — a demonstrated problem makes shipping unsafe or breaks a required gate.
- **NOT REVIEWED** — evidence is insufficient to judge readiness.

Support verdicts and conditions with evidence. Missing evidence is not proof of
a defect. State what check or fix is needed without inventing an escalation owner.
A simplification review need not make a release decision at all.

## Verification guidance

Run relevant project checks and `git diff --check` when practical. For code
changes, use focused tests and the full check/test suite where feasible. For
skill or prompt changes, check frontmatter and existing markdown-sensitive tests.
Report failures and checks not run accurately.

When touching automation or archived/session data, use the repo's secret scanner
on bounded allowed paths. A fallback marker pattern is
`api[_-]?key|secret|token|password|passwd|private[_-]?key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY`.
Report filenames or counts, never matching secret values or raw sensitive logs.

## Output template

Adapt to the request; this is optional:

- **Assessment:** one sentence answering the question.
- **Findings:** ranked problems with evidence, impact, and a practical fix.
- **Validation:** commands and outcomes; scope or evidence limits.

Keep the answer concise. Add a durable report only when requested or genuinely
useful for future work; do not duplicate execution records.

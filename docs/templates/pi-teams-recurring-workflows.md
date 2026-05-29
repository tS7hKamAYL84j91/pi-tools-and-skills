# pi-teams Recurring Workflow SOP Templates

Date: 2026-05-29
Scope: static Markdown templates only

## Purpose

Reusable operator SOPs for common `pi-teams` workflows. These templates are copyable prompts/checklists; they do not add a template engine, runtime behavior, public schema, provider integration, or scheduling.

## Shared rules

- Use only synthetic placeholders such as `<TASK_ID>`, `<PATHS>`, and `<ARTIFACT_PATH>`.
- Prefer `team_run` with `id="navigator"` for focused review and `id="llm-council"` for architecture, public API, persistence, security, or cross-extension decisions.
- Use `team_run` with `id="deep-research"` only for bounded synthesis that needs Explorer -> Verifier -> Synthesis evidence loops.
- Keep handoffs compact. Use claim-check paths to existing files/reports instead of pasting large logs or private data.
- Record reviewer disposition as `PASS`, `PASS_WITH_NOTES`, `BLOCK`, or `ESCALATE`.
- Do not include credentials, raw private prompts, session transcripts, Matrix/mailbox payloads, keychain data, working-notes, or kanban runtime state.

---

## SOP 1 — Architecture or Code Review

### Purpose

Get an independent review before finalizing changes that affect architecture, extension boundaries, tests, public docs, or operator UX.

### When to use

Use this workflow when any of these are true:

- The change touches pi extension behavior, public tools/commands, persistence, or lifecycle semantics.
- The change is a non-trivial code or documentation update that needs a skeptical second pass.
- The implementation is small but easy to overreach, such as a helper fix with compatibility implications.
- You need a reviewer-pass record before commit.

Use `llm-council` instead of `navigator` when the decision creates/removes a public API, changes architecture boundaries, changes persistence contracts, or requires explicit tradeoff debate.

### Inputs

- `<TASK_ID>` — task or ticket id.
- `<GOAL>` — one-sentence outcome.
- `<CHANGED_PATHS>` — concise list of files and purpose.
- `<DIFF_SUMMARY>` — behavior/docs/test summary, not a raw full diff unless tiny.
- `<VALIDATION>` — targeted tests, `npm run check`, `npm test`, secret scan, or reason not applicable.
- `<RISKS>` — known compatibility, schema, persistence, or UX risks.
- `<ADR_DISPOSITION>` — `No ADR` with rationale, `ADR updated`, or `ADR required before implementation`.

### Team selection

- Default: `navigator` for focused correctness/scope review.
- Escalate to `llm-council` for architecture, public contract, security/privacy, persistence, cross-repo, or irreversible choices.
- Do not use a team when the change is purely mechanical and already covered by deterministic checks; record a no-review rationale instead.

### Handoff and claim-check expectations

- Cite file paths and line/section names.
- Cite test command output summaries, not full logs.
- Use claim-check paths for reports, ADRs, screenshots, or generated artifacts.
- State exactly what changed and what did not change.

### Checks

Run as applicable:

```bash
npm run check
npm test
```

For docs-only changes, still run `git diff --check` and a touched-file secret-marker scan. Use staged `gitleaks` before commit when available.

### Copyable reviewer brief

```text
Review <TASK_ID> for correctness, scope, and safety.

Goal:
<GOAL>

Changed paths:
<CHANGED_PATHS>

Diff summary:
<DIFF_SUMMARY>

Validation:
<VALIDATION>

Constraints / non-goals:
<RISKS>

ADR disposition:
<ADR_DISPOSITION>

Please return PASS/BLOCK. Flag behavior drift, missing tests, overreach, or ADR/approval needs.
```

### DONE / BLOCKED / escalate criteria

Report `DONE <TASK_ID>` only when:

- Reviewer returns `PASS` or `PASS_WITH_NOTES` and required fixes are applied.
- Required validation and secret scans pass or have an explicit no-run rationale.
- Commit/push status is known.

Report `BLOCKED <TASK_ID>` when:

- Reviewer blocks on public contract, persistence, approval, or safety ambiguity.
- Required checks fail and a minimal safe fix is not obvious.
- The change would require runtime behavior outside approved scope.

Escalate to `llm-council` when Navigator identifies a design dispute rather than an implementation nit.

---

## SOP 2 — Research Synthesis / Evidence Review

### Purpose

Use `deep-research` or a bounded manual research handoff to synthesize evidence, identify gaps, and produce a verified report without live-provider assumptions or unapproved artifact persistence.

### When to use

Use this workflow when:

- The question needs evidence gathering, critique, and synthesis rather than a quick code review.
- A report must distinguish verified facts, inferences, risks, and open questions.
- There are multiple candidate sources or claims that need gap detection.

Do not use this workflow for simple implementation reviews, private data mining, provider-backed research, live network work, or credentialed tools unless separately approved.

### Inputs

- `<RESEARCH_QUESTION>` — bounded question.
- `<SOURCE_PATHS>` — repo-local docs/code paths or synthetic source list.
- `<KNOWN_FACTS>` — short facts already verified by the operator.
- `<OPEN_QUESTIONS>` — specific gaps to verify.
- `<ARTIFACT_PATH>` — intended report path if writing a durable summary.
- `<TOOL_BOUNDARY>` — registered tools allowed or `no live tools/network`.
- `<APPROVAL_NOTES>` — provider/artifact/ADR gates that must not be crossed.

### Team selection

- Use `deep-research` for Explorer -> Verifier -> Synthesis loops when the evidence set is broad.
- Use `navigator` when the research output is already drafted and only needs a focused plausibility/gap review.
- Use `llm-council` when the research drives architecture strategy or contested tradeoffs.

### Handoff and claim-check expectations

- Put large source material in durable files and reference paths.
- Ask for source bindings or claim-check references for substantive claims.
- Require explicit `verified facts`, `inferences`, `risks`, and `open questions` sections.
- Do not paste private transcripts, credentials, private customer data, or unredacted logs.

### Checks

For docs/reports produced from synthesis:

```bash
git diff --check
npm run check
```

Run `npm test` when code, manifests, config, prompts, or tests changed. Run staged `gitleaks` before commit when available.

### Copyable research brief

```text
Run a bounded research synthesis for <TASK_ID>.

Question:
<RESEARCH_QUESTION>

Sources / claim-checks:
<SOURCE_PATHS>

Known facts:
<KNOWN_FACTS>

Open questions / gaps:
<OPEN_QUESTIONS>

Tool boundary:
<TOOL_BOUNDARY>

Output expectations:
- verified facts
- inferences
- recommendations
- risks
- open questions
- source bindings / claim-checks

Approval notes / non-goals:
<APPROVAL_NOTES>

If evidence is insufficient, return BLOCKED with the exact missing source or approval gate.
```

### DONE / BLOCKED / escalate criteria

Report `DONE <TASK_ID>` only when:

- Synthesis separates verified facts from inference.
- Source bindings or claim-checks are present for substantive claims.
- Reviewer pass or explicit no-review rationale is recorded.
- Validation and secret scans pass for touched files.

Report `BLOCKED <TASK_ID>` when:

- Required evidence is unavailable.
- The work needs provider-backed tools, live network, credentials, or artifact persistence that is not already approved.
- The output would rely on private/raw source material that cannot be safely summarized.

Escalate to `llm-council` if the synthesis changes architecture direction, public contracts, or approval policy.

## ADR disposition

No ADR is required for these SOP templates because they are static Markdown guidance and do not alter public/runtime/team config contracts, schemas, persistence, provider behavior, or execution semantics. A future ADR is required before turning these templates into runtime commands, scheduler policy, mandatory gates, or public template-pack contracts.

---
description: Catch up on in-progress branch work, then refactor for quality
argument-hint: "[base-ref]"
---
Review the changes on this branch with git to catch up on the work in progress,
then refactor that work for quality.

Base ref: ${1:-origin/main}. If that ref is missing, fall back to the merge base
with the default branch and say which ref you used.

## Phase 1 — Catch up

Establish what the branch is doing without editing anything: `git status`,
`git diff`, `git log --oneline <base>..HEAD`, and the files behind ambiguous
hunks. Then state, briefly:

- the intent and purpose of the changes;
- what has landed, grouped by purpose;
- what is unfinished, including docs that no longer match behaviour.

Do not edit in this phase and preserve unrelated work.

## Phase 2 — Refactor

Make the branch's own changes short and concise.

- Apply KISS, YAGNI, DRY and clean architecture. Prefer simpler code to a smaller
  file count; do not split files or add abstractions to satisfy a metric.
- Preserve external interfaces and behaviour: command names, CLI flags, config
  schemas, file formats, persisted state and safety gates.
- Delete only dead code you have confirmed is unused, and keep a refactor
  separable from behaviour changes. Report a real defect instead of folding the
  fix into the refactor.
- Remove temporary scratch documents. Update the documents that explain the
  shipped behaviour: package READMEs, `docs/`, `AGENTS.md`, and `CHANGELOG.md`
  under `## [Unreleased]` for user-visible changes.

## Verify

- `make check`, `make test`, `git diff --check`.
- Add `make semgrep-scan`, `make secret-scan` or `make build` when the change
  touches their surface; run focused Vitest files while working.
- Python tooling (`pyscn`, `ruff`, `pytest`) is not configured in this repository,
  so record that instead of adding configuration. Do not weaken configured gates.

Finish with a short summary: what the branch does, what became simpler, the checks
you ran, and the risks or follow-ups that remain.

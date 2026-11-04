---
description: Catch up on in-progress work on this branch
argument-hint: "[base-ref]"
---
Review the changes on this branch with git to catch up on the work in progress.

Base ref: ${1:-origin/main}. If that ref is missing, fall back to the merge base
with the default branch and say which ref you used.

## Gather

- State: `git status`, `git diff --stat`, `git diff -- <path>` for the ambiguous
  files, and `git log --oneline <base>..HEAD`.
- Separate committed work from staged, unstaged and untracked work, and say which
  is which — a changed file and a changed-but-unstaged file mean different things.
- Read the files behind terse commit messages instead of trusting the message.
- Skip generated output, lockfiles and formatting noise; do not summarise every
  hunk.

## Report

1. **Intent** — what the branch is trying to achieve, in two or three sentences.
2. **What has landed** — the changes grouped by purpose, not by file.
3. **What is unfinished** — half-done paths, TODOs, missing or failing tests, docs
   that no longer match behaviour, and anything that looks accidental.
4. **What remains** — a short ordered list of the next concrete steps.

Preserve unrelated work: do not edit, revert or discard anything in this command.
State uncertainty instead of guessing, and ask at most one clarifying question when
the intent is genuinely ambiguous.

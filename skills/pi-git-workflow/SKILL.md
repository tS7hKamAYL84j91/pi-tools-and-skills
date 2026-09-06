---
name: pi-git-workflow
description: Review, stage, commit, and push authorized changes while preserving unrelated work. Use when committing changes, managing branches, or explicitly cleaning up worktrees.
---

# Pi Git Workflow

Commit and push only when authorized. Follow the repository's branch policy;
this skill does not require a new branch, PR, or commit series for every change.

## Commit and push

1. Inspect `git status` and the relevant diff. Preserve unrelated changes and
   existing staged work; do not automatically stash, reset, or clean it.
2. Run relevant project checks and `git diff --check`. Fix regressions; report
   pre-existing failures accurately rather than hiding them.
3. Stage explicit relevant paths with `git add <paths>`. Inspect
   `git diff --cached` before committing; do not sweep in other people's work.
4. Use a concise conventional commit: `<type>(<scope>): <summary>`.
   Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
5. If pushing is requested, verify the target branch and outgoing commits, push,
   and report the commit hash and outcome.

Keep one logical change together, including its tests, documentation, and any
required lockfile update. Split independent changes only when that makes review
or rollback easier. Do not build dependency graphs or require human intervention
just to choose a commit order.

## Safety

- Never commit secrets, tokens, private logs, or generated noise such as
  `node_modules/` and `dist/`.
- Do not force-push shared branches or rewrite others' history without approval.
- Resolve merge conflicts deliberately; ask when intent is genuinely ambiguous.
- Worktree and branch cleanup is separate work: do it only when requested and
  after confirming there is no uncommitted or active work to lose.

---
name: pi-git-workflow
description: Automate git review, stage, commit, and push workflows. Use when committing changes, reviewing working trees, managing branches, or cleaning up worktrees.
---

# Pi Git Workflow

Use this skill for automated git operations during implementation work.

## Standard commit workflow

The most common pattern seen in sessions:

```
1. Review working tree   → git status, git diff --stat
2. Stage changes         → git add -A (or selective if unrelated files)
3. Commit                → conventional commit message
4. Push                  → git push
```

### Commit message format

Use conventional commits with scope:

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`
Scopes: extension names (`teams`, `kanban`, `coas`, `panopticon`, `matrix`), `skills`, `docs`, `build`

Examples:
```
feat(teams): add team_models tool for runtime model override
fix(kanban): prevent double-claim race on WIP limit edge
refactor(skills): consolidate agent messaging guidance
docs(adr): record topology decision 013
```

## Selective staging

When the working tree contains unrelated changes:

1. Run `git diff --name-only` to see all changed files.
2. Stage only relevant files: `git add <path1> <path2>`
3. Verify with `git diff --cached --stat` before committing.
4. Leave unrelated changes unstaged — or explicitly `git stash` them if needed.

## Atomic commit ordering (omp-commit pattern)

For larger changes, produce a set of minimal, dependency-ordered commits instead of one
mixed commit. Adapted from the MIT `omp` commit helper (clean-room concepts; do not copy
`omp` source).

1. **Read the working tree:** use `git status --porcelain` and `git diff --name-only`
   to discover changed files.
2. **Exclude non-source noise:** skip lock files and generated artifacts; do not try
   to order or split them.
3. **Group into atomic change sets:** identify which files move together as one logical
   change. Score source files above tests, docs, and config files when a tie needs to be
   broken.
4. **Build a dependency graph:** determine which change sets must land before others
   (for example, a new API must exist before tests that import it, or a schema change
   before consuming code).
5. **Reject cycles:** if the dependency graph has a cycle, stop before writing anything.
   The human must resolve the entanglement; do not fabricate an order.
6. **Commit in topological order:** stage and commit each change set with a focused
   conventional commit message.

> **Candidate future extension:** a `conflict://` resolution UX that writes `@ours`,
> `@theirs`, and `@base` slices for each merge conflict so a tool or human can resolve
> deterministically. This is ADR-gated; do not build it as part of this skill update.

## Branch management

- Feature branches: `feat/<description>`, `fix/<description>`
- Commit directly to `main` only for trivial doc fixes or chore changes.
- After pushing a feature branch, merge via PR or fast-forward.
- Delete merged branches: `git branch -d <branch>`

## Worktree cleanup

When `git worktree list` shows stale worktrees:

1. Identify which are no longer in active use.
2. Remove with `git worktree remove <path>`.
3. Prune stale metadata: `git worktree prune`.

## Pre-commit validation

Before committing, verify the project passes:

```bash
npm run check    # typecheck + lint + knip + type-coverage
npm test         # vitest
```

If checks fail, fix before committing. Do not commit broken code.

## Pre-push check

Before pushing to a shared branch (main, feat/*):

1. Ensure all pre-commit validation passes.
2. Check `git log origin/main..HEAD --oneline` for clean history.
3. Push: `git push origin <branch>`.

## Gotchas

- Never commit generated files (node_modules, dist, .DS_Store) — verify with `git status` first.
- Never commit secrets, API keys, or tokens.
- Don't `git add -A` blindly if other work is in progress in the same tree.
- If a rebase or merge conflict occurs, resolve deliberately — do not force-push to main.
- Worktrees share the same `.git` — removing one worktree does not delete branches.

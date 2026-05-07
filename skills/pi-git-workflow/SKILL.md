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

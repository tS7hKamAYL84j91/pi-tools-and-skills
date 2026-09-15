---
name: worktree-isolation
description: Isolate repo-mutating sub-agents in a dedicated git worktree with its own branch so concurrent agents never edit the same checkout. Use when spawning agents whose task will modify files, when coordinating multiple in-flight edits, or when recovering stale worktrees after failed or abandoned runs. Exists because of the T-923 collision: two agents edited the same pi-kanban overlay files concurrently and left a transient duplicate-declaration breakage.
---

# Worktree Isolation

Each spawned agent that mutates repo files works in its own git worktree on its
own branch. The spawner owns the merge. Read-only helpers skip isolation.

## Why

Git worktrees give each agent an independent checkout of the same repository.
Without one, concurrent agents edit the same files and the later writer collides
with the earlier one — T-923 is the recorded evidence: an in-flight run and a
second run both refactored `extensions/pi-kanban/overlay-*.ts`, producing a
duplicate `beginModalFrame` declaration and a doubled function signature that
broke the build mid-task. Worktree isolation makes that collision impossible
instead of merely recoverable.

## When to isolate

- **Isolate**: any spawned sub-agent whose task changes files — refactors,
  features, migrations, bulk edits, generated code.
- **Skip**: read-only helpers — reviewers, researchers, scanners, status checks.
  They read the main checkout and need no worktree.

## Setup (spawner, once per mutating agent)

1. From the main checkout, create the worktree with its own branch, **outside
   the main checkout path**:

   ```sh
   git worktree add /tmp/<repo>-<agent>-<task> -b <agent>/<task>
   ```

   This repo's existing convention is `/tmp/pi-tools-<task>` with task-prefixed
   branches (`fix/t-888-scheduler-dedup`); any location outside the checkout
   (`../worktrees/<name>`) is fine. Never place a worktree inside the main
   checkout.
2. Spawn the sub-agent with its cwd pointed at the worktree (pi `spawn_agent`
   takes a `cwd` parameter). State the worktree path and branch name in the
   brief so the agent commits on its own branch, not on the main checkout's.
3. **One agent per worktree — never two.** If several agents contribute to one
   task, give each its own worktree and branch, then merge serially.

## Guardrails

- One agent per worktree; the spawner owns the merge decision. Sub-agents never
  merge, push, or touch branches outside their worktree.
- The main checkout stays on its branch; agents never run `worktree add` from
  inside another worktree.
- Commit inside the worktree follows the normal [pi-git-workflow](../pi-git-workflow/SKILL.md)
  rules: explicit staging, project checks, conventional commit messages.

## Completion (owner)

1. Have the agent finish with checks green and its work committed on its branch.
2. Review from the main checkout: `git diff main...<branch>`.
3. Merge deliberately — `git merge --ff-only <branch>` when history is linear,
   or a squash merge when the branch is noisy. Resolve conflicts yourself.
4. After merging, clean up: `git worktree remove <path>` and
   `git branch -d <branch>`.
5. To discard the work instead: `git worktree remove --force <path>` then
   `git branch -D <branch>`.

## Failure and stale-worktree recovery

- If a run dies leaving uncommitted changes, inspect before deleting:
  `git -C <path> status --short`. Salvage anything useful as a patch or diff
  before removal; do not `--force` over uncommitted work blindly.
- If the worktree directory was deleted behind git's back, the entry lingers:
  `git worktree prune -v` removes stale registrations (observed with several
  abandoned `/tmp` worktrees in this repo's history).
- Never remove a worktree you did not spawn without confirming it has no active
  owner and no uncommitted work — cleanup is the pi-git-workflow "separate
  work" rule.
- Diagnose drift first: `git worktree list` shows every live worktree and its
  branch; unknown or detached-HEAD entries are stale candidates, not targets
  for reuse.

## Verification

After setup: `git worktree list` shows the new worktree on its new branch, and
the spawned agent's cwd resolves inside it. After completion: the worktree and
branch are gone (or pruned) and `main` carries the merged (or no) change.
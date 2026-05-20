# pi-goal Extension

Bounded project-goal workflow tools and the `/goal` command for pi.

## Commands

- `/goal <text>` — create a project goal from text and start a bounded run.
- `/goal file <path> [goal start|--until-complete]` — use an existing project file as the goal source; with `goal start`/`--until-complete`, create `.pi-goal/TODO.md` from the file and start a 20-turn run.
- `/goal status` — show the current goal state.
- `/goal run [--turns N|--until-complete]` — continue an active or paused goal.
- `/goal pause`, `/goal resume`, `/goal stop`, `/goal clear` — manage goal lifecycle.

## Tools

- `goal_get` — read the current project-local goal state.
- `goal_complete` — mark the goal complete with concrete audit evidence.

## Runtime files

The extension writes project-local state under `.pi-goal/` and adds that directory to `.git/info/exclude` when possible. The goal source file, summary, and run transcripts remain local runtime artifacts and are not intended for package distribution.

## Enablement

`pi-goal` is a project/runtime extension. Enable it per workspace by adding the package extension path to that workspace's `.pi/settings.json`; it is intentionally not enabled globally by `make setup`.

Runtime state and run transcripts under `.pi-goal/` are local operational artifacts, not source-controlled package content.

## What this does not do

- Does not replace project task boards or kanban systems.
- Does not mark goals complete automatically; the root agent must call `goal_complete` with concrete evidence.
- Does not bypass normal pi session boundaries; bounded runs use fresh sessions and graceful stop points.

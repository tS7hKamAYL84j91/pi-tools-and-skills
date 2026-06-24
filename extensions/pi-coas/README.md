# Pi CoAS Extension

TypeScript-native pi control surface for CoAS workspace, schedule, status, and
health state under project-local `.pi/coas` when present, otherwise `${COAS_HOME:-${AGENT_HOME:-$HOME}/.pi/coas}`.

This extension does **not** depend on a sibling `~/git/coas` checkout and does
not shell out to CoAS scripts. Schedules are run by an in-process pi-hosted
scheduler while pi is open; no user crontab is read or modified.

`pi-coas` owns recurring operational scheduling and policy, including WIP pick
routines, morning briefs, state capture, and recurring reviews. Those schedules
may instruct use of `kanban_*` tools, but cron/cadence/policy ownership stays in
CoAS rather than `pi-kanban`.

## Stable Tools/Commands

### Tools

| Tool | Purpose |
|---|---|
| `coas_status` | Summarize the local CoAS data root |
| `coas_doctor` | Run TypeScript runtime diagnostics |
| `coas_workspace_list` | List `${COAS_HOME}/workspace` (or legacy `workspaces`) |
| `coas_workspace_read` | Read workspace `CONTEXT.md` by gradual disclosure; summary by default, guarded `section`/`full` modes |
| `coas_workspace_update` | Append stable non-secret facts to `CONTEXT.md`; archives/compacts oversized active context |
| `coas_workspace_create` | Create a workspace record without Matrix room creation |
| `coas_schedule_list` | List file-backed schedules; optional `cwd` targets another project's CoAS runtime |
| `coas_schedule_preview` | Read-only preview of enabled schedules; optional `cwd` targets another project's runtime |
| `coas_schedule_add` | Add a file-backed schedule and reconcile the internal scheduler when targeting the current runtime; optional `cwd` adds to another project |
| `coas_schedule_run` | Dry-run a schedule; optional `cwd` targets another project's runtime |
| `coas_schedule_remove` | Remove a schedule file pair and reconcile the internal scheduler when targeting the current runtime; optional `cwd` removes from another project |

### Commands

- `/coas-status`
- `/coas-doctor`
- `/coas-workspaces`
- `/coas-schedules`
- `/coas-scheduler` — show and reconcile the in-process scheduler

## Provisional Surfaces

- Workspace fact extraction and summarization hooks.
- Schedule recurring rules syntax expansion.

## Cross-Extension Dependencies

- Schedules may invoke `kanban_*` tools (provided by `pi-kanban`).
- Uses `pi-panopticon` for injecting schedule prompts.

## TUI Status

When CoAS context exists, the status bar shows a compact operational field:

```text
coas: <workspace|on> <✓|idle|⚠> [sch enabled/active]
```

This is intentionally operational state only: workspace/scheduler health, enabled schedules, and active runs.

## Configuration

Resolution order:

1. Explicit `COAS_HOME`.
2. Project `.pi/settings.json` `coas.coasHome`.
3. Nearest project-local `.pi/coas` containing `workspace/`.
4. User/global settings `coas.coasHome`.
5. `${AGENT_HOME:-$HOME}/.pi/coas`.

The workspace registry directory is `workspace/`.

Optional `.pi/settings.json` override:

```json
{
  "coas": {
    "coasHome": "~/.pi/coas"
  }
}
```

`COAS_HOME` wins over all discovery. Project-local discovery wins over user/global settings so EO repo-local CoAS state is preferred by default.

## Workspace Context Policy

`CONTEXT.md` is active durable memory, not a transcript dump. Keep it small and SPR-style: stable, non-secret facts that are useful across turns/sessions.

`coas_workspace_read` is gradual-disclosure safe:

- Default mode is `summary`: returns path, byte size, sampled headings, and a bounded preview only.
- `mode=section` requires `section` heading text and is guarded for oversized files.
- `mode=full` is explicit and rejected for files above the hard full-read limit.

`coas_workspace_update` appends a stable fact, then compacts when active `CONTEXT.md` exceeds the threshold. Compaction copies the previous file into `archive/CONTEXT.<timestamp>.md` with private permissions and rewrites the active file to a small SPR memory plus archive index.

## What this does NOT do

- Does not install cron or modify host scheduler state.
- Does not run schedules while pi is closed.
- Does not own kanban board mechanics; scheduled prompts may use `kanban_*` tools but cadence/policy stays in CoAS.
- Does not create Matrix rooms or mutate external services.
- Does not store secrets in workspace context.

## Safety

- No model-callable tool can install cron or modify host scheduler state.
- The internal scheduler only runs while pi is open and injects due schedule prompts as pi user messages.
- CoAS schedules may use `kanban_*` tools for board work, but `pi-kanban` remains a schedule-free board surface.
- Workspace reads/writes are confined to `${COAS_HOME}/workspace` unless the target already has `.pi/coas/workspace.env` metadata.
- Workspace context reads default to bounded summaries; full/section reads have hard size guards.
- Workspace context updates use pi's file mutation queue, reject symlinked `CONTEXT.md` files, and archive before compacting oversized active context.
- Schedule files preserve the existing `.env` + `.prompt` storage format but are written from TypeScript with private permissions.
- Tool output is truncated before entering model context.

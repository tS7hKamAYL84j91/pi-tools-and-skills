# Pi CoAS Extension

TypeScript-native pi control surface for CoAS workspace, schedule, status, and
health state under `${COAS_HOME:-~/.coas}`.

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
| `coas_workspace_list` | List `${COAS_HOME:-~/.coas}/workspaces` |
| `coas_workspace_read` | Read a real workspace `CONTEXT.md` |
| `coas_workspace_update` | Append stable non-secret facts to `CONTEXT.md` |
| `coas_workspace_create` | Create a workspace record without Matrix room creation |
| `coas_schedule_list` | List file-backed schedules |
| `coas_schedule_add` | Add a file-backed schedule and reconcile the internal scheduler |
| `coas_schedule_run` | Dry-run a schedule; enabled schedules run through the internal scheduler |
| `coas_schedule_remove` | Remove a schedule file pair and reconcile the internal scheduler |

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

Defaults:

- `COAS_HOME=${HOME}/.coas`

Optional `.pi/settings.json` override:

```json
{
  "coas": {
    "coasHome": "~/.coas"
  }
}
```

`COAS_HOME` wins over settings.

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
- Workspace reads/writes are confined to `${COAS_HOME}/workspaces` unless the target already has `.coas/workspace.env` metadata.
- Workspace context updates use pi's file mutation queue and reject symlinked `CONTEXT.md` files.
- Schedule files preserve the existing `.env` + `.prompt` storage format but are written from TypeScript with private permissions.
- Tool output is truncated before entering model context.

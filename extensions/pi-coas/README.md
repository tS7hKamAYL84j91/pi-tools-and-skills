# Pi CoAS Extension

TypeScript-native pi control surface for CoAS workspace, schedule, status, and
health state under `${COAS_HOME:-~/.coas}`.

This extension does **not** depend on a sibling `~/git/coas` checkout and does
not shell out to CoAS scripts. Matrix room bootstrap and arbitrary scheduled
execution remain out of scope until they have a standalone reviewed runner.

## Tools

| Tool | Purpose |
|---|---|
| `coas_status` | Summarize the local CoAS data root |
| `coas_doctor` | Run TypeScript runtime diagnostics |
| `coas_workspace_list` | List `${COAS_HOME:-~/.coas}/workspaces` |
| `coas_workspace_read` | Read a real workspace `CONTEXT.md` |
| `coas_workspace_update` | Append stable non-secret facts to `CONTEXT.md` |
| `coas_workspace_create` | Create a workspace record without Matrix room creation |
| `coas_schedule_list` | List file-backed schedules |
| `coas_schedule_add` | Add a file-backed schedule, without installing cron |
| `coas_schedule_run` | Dry-run by default; non-dry-run execution is disabled for safety |
| `coas_schedule_remove` | Remove a schedule file pair |

## Commands

- `/coas-status`
- `/coas-doctor`
- `/coas-workspaces`
- `/coas-schedules`
- `/coas-cron-install` — command exists but reports disabled until a standalone runner exists
- `/coas-cron-uninstall` — command exists but reports disabled until a standalone runner exists

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

## Safety

- No model-callable tool can install cron or execute arbitrary schedule payloads.
- Cron commands are human-triggered and currently disabled rather than pretending to be safe.
- Workspace reads/writes are confined to `${COAS_HOME}/workspaces` unless the target already has `.coas/workspace.env` metadata.
- Workspace context updates use pi's file mutation queue and reject symlinked `CONTEXT.md` files.
- Schedule files preserve the existing `.env` + `.prompt` storage format but are written from TypeScript with private permissions.
- Tool output is truncated before entering model context.

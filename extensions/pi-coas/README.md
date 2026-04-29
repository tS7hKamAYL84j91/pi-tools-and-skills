# Pi CoAS Extension

Typed pi control surface for the CoAS runtime repo (`~/git/coas`).

This extension does **not** replace CoAS host scripts. It wraps them so the
agent and operator can use narrow tools/commands instead of raw shell.

## Tools

| Tool | Purpose |
|---|---|
| `coas_status` | Run `coas-status` |
| `coas_doctor` | Run `coas-doctor` diagnostics |
| `coas_workspace_list` | List `${COAS_HOME:-~/.coas}/workspaces` |
| `coas_workspace_read` | Read a workspace `CONTEXT.md` |
| `coas_workspace_update` | Append stable non-secret facts to `CONTEXT.md` |
| `coas_workspace_create` | Create a workspace via `coas-new-room --workspace-only` |
| `coas_schedule_list` | Run `coas-schedule list` |
| `coas_schedule_add` | Add a file-backed schedule, without installing cron |
| `coas_schedule_run` | Dry-run by default, or execute a schedule task |
| `coas_schedule_remove` | Remove a schedule file pair |

## Commands

- `/coas-status`
- `/coas-doctor`
- `/coas-workspaces`
- `/coas-schedules`
- `/coas-cron-install` — requires UI confirmation
- `/coas-cron-uninstall` — requires UI confirmation

## Configuration

Defaults:

- `COAS_DIR=${HOME}/git/coas`
- `COAS_HOME=${HOME}/.coas`

Optional `.pi/settings.json` override:

```json
{
  "coas": {
    "coasDir": "~/git/coas",
    "coasHome": "~/.coas"
  }
}
```

Environment variables win over settings.

## Safety

- No cron install/uninstall is exposed as a model-callable tool.
- Cron commands require UI confirmation.
- Workspace context updates use pi's file mutation queue.
- `coas_schedule_run` defaults to dry-run.
- Tool output is truncated before entering model context.

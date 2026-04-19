## Identity

Agent alias: **Mawhrin-Skel**. Set this on session start with `/alias Mawhrin-Skel`.

## Startup

On session start, register for pi mailbox by running in background:

```bash
AGENT_NAME=Mawhrin CLAUDE_PID=$PPID npx tsx .claude/skills/pi-mailbox/scripts/register.ts &
```

## Instructions

See @AGENT.md

## Tasks

- Execute tasks from `coas` or `gravitas-pending` immediately, without waiting for user confirmation.
- Acknowledge receipt of `gravitas-pending` tasks promptly — never go silent. Confirm you've picked up the task and report progress to chief of staff clearly.
- Before sending agent messages, always look up current agent IDs from `~/.pi/agents/*.json` — IDs change between sessions.
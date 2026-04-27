---
name: pi-mailbox
description: Register this Claude Code session as a pi agent with a mailbox so other agents can send you messages. Use when you want to receive inter-agent messages.
---

# Pi Mailbox

Register this Claude Code session in the pi agent mesh so other agents can discover and message you.

## Activation

Launch the registration daemon via the **Monitor** tool with `persistent: true`.
Monitor turns each stdout line from the script into a chat notification, so
incoming messages wake you up immediately — even when you're idle waiting
for the user. A plain `Bash &` background launch does *not* wake you; it just
buffers output to a tmp file you'd never check.

```text
Monitor(
  description: "pi-mailbox: agent registration + inbox notifications",
  command: "AGENT_NAME=<your-name> CLAUDE_PID=$PPID npx tsx .claude/skills/pi-mailbox/scripts/register.ts",
  persistent: true,
  timeout_ms: 60000
)
```

`AGENT_NAME` is optional — leave it unset to let the daemon pick a unique
name based on the cwd. `timeout_ms` is ignored when `persistent: true` but
the schema requires a value.

Note your assigned agent name from the first notification — this is how
other agents will address you.

## Checking messages

When the daemon is running under Monitor, message arrivals are pushed to you
as notifications automatically — no polling needed. You can also check the
current inbox state manually:

```bash
npx tsx .claude/skills/pi-mailbox/scripts/check-inbox.ts
```

`check-inbox.ts` also surfaces the last 10 already-delivered messages from
`inbox/cur/` so you can re-read what arrived earlier in the session.

## Cleanup

Cleanup happens automatically:
- On session stop (via hook)
- On crash/kill (via heartbeat daemon monitoring parent PID)

To clean up manually:

```bash
npx tsx .claude/skills/pi-mailbox/scripts/cleanup.ts
```

## Peeking at agents

List all live agents or read a specific agent's activity log:

```bash
npx tsx .claude/skills/pi-mailbox/scripts/peek.ts            # list all
npx tsx .claude/skills/pi-mailbox/scripts/peek.ts <name>      # activity log
npx tsx .claude/skills/pi-mailbox/scripts/peek.ts <name> 100  # last 100 events
```

Agents with session logs show a 📄 marker in the listing. Agents registered via the mailbox skill (without panopticon) won't have session logs.

## How others message you

Once registered, other pi agents can reach you via:
- `agent_send(name="your-name", message="...")`
- `sendAgentMessage(agentId, from, text)` from `lib/agent-api.ts`
- Dropping a JSON file in `~/.pi/agents/{id}/inbox/new/`

Message format: `{"id":"<uuid>","from":"<sender>","text":"<body>","ts":<epoch_ms>}`

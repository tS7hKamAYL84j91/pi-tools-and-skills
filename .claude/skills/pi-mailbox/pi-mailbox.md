---
name: pi-mailbox
description: Register this Claude Code session as a pi agent with a mailbox so other agents can send you messages. Use when you want to receive inter-agent messages.
---

# Pi Mailbox

Register this Claude Code session in the pi agent mesh so other agents can discover and message you.

## Activation

Run the registration script in the background (it stays alive for heartbeat):

```bash
CLAUDE_PID=$PPID npx tsx .claude/skills/pi-mailbox/scripts/register.ts &
```

Note your assigned agent name from the output — this is how other agents will address you.

## Checking messages

Messages are checked automatically after each tool use via a hook. You can also check manually:

```bash
npx tsx .claude/skills/pi-mailbox/scripts/check-inbox.ts
```

When messages arrive, read them and respond appropriately. Messages from other agents are wrapped with sender info and timestamp.

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

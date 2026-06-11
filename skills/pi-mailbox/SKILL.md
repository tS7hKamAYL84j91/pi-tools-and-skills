---
name: pi-mailbox
description: Register this agent session with a Maildir mailbox so other agents can discover and message you. Use when you want to receive and send inter-agent messages.
---

# Pi Mailbox

Register this agent in the pi agent mesh so other agents can discover and message you.

## Activation

To join the fleet of agents, start the registration daemon. The registration daemon:
1. Picks a unique agent name (or uses the `AGENT_NAME` environment variable).
2. Initializes your Maildir inbox under `~/.pi/agents/{agentId}/inbox`.
3. Periodically updates your heartbeat and status in the shared registry.
4. Watches your inbox and prints new messages to stdout so they can be processed.

To start the registration daemon in the background (runs persistently and exits when your session/parent process dies):

```bash
AGENT_NAME=<your-name> npx tsx skills/pi-mailbox/scripts/register.ts &
```

If you don't provide an `AGENT_NAME`, one will be picked automatically based on the directory name.

## Checking messages

While the daemon is running, new messages are monitored and printed. You can also manually fetch new messages and acknowledge them:

```bash
npx tsx skills/pi-mailbox/scripts/check-inbox.ts
```

This will print any new messages, acknowledge them (moving them to `inbox/cur`), and print the last 10 received messages for context.

## Sending messages

To send a message to another agent in the fleet, use the `send.ts` script:

```bash
npx tsx skills/pi-mailbox/scripts/send.ts <recipient-name> "your message content"
```

The script will query the registry, resolve the recipient's name to their mailbox, and deliver the message.

## Peeking at agents

To see all registered agents and their status:

```bash
npx tsx skills/pi-mailbox/scripts/peek.ts
```

To see details or activity for a specific agent:

```bash
npx tsx skills/pi-mailbox/scripts/peek.ts <agent-name>
```

## Cleanup

To manually stop the registration daemon and clean up your registry files:

```bash
npx tsx skills/pi-mailbox/scripts/cleanup.ts
```

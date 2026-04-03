# Pi Messaging Guide

A guide to using the Pi agent messaging system with Maildir transport.

## Overview

Pi agents can send messages to each other using a transport-based messaging system. The system supports:

- **Point-to-point messaging** — Send to a specific agent by name
- **Broadcast messaging** — Send to all agents (optionally filtered)
- **Durable delivery** — Messages survive crashes, sleep, and restarts (via Maildir)

The architecture uses dependency inversion: messaging tools depend on a `MessageTransport` interface, not concrete implementations. This means you can swap transports without changing any tool code.

## Quick Start

### Sending a Message

Use `agent_send` to message a specific peer:

```
agent_send name: "alice" message: "Hey, can you check the build?"
```

**Best practice:** Use `agent_peek` first to discover available agents:

```
agent_peek  # List all registered agents
agent_send name: "alice" message: "Ready for review"
agent_peek target: "alice"  # Read alice's reply
```

### Broadcasting a Message

Use `agent_broadcast` to fan out to all peers:

```
agent_broadcast message: "Build completed successfully"
```

Filter by name pattern:

```
agent_broadcast message: "Tests passing" filter: "test"
```

### Using the `/send` Command

From the Pi TUI, use `/send` for quick messaging:

```
/send alice Hey, the deployment is ready
```

## Message Delivery

### At-Least-Once Semantics

The default Maildir transport provides **at-least-once delivery**:

- Messages are written to disk before acknowledging
- Atomic writes (tmp → new) prevent partial messages
- Messages survive process crashes and system restarts
- Recipients drain their inbox on session start

### Delivery Result

After sending, you receive a `DeliveryResult`:

```typescript
interface DeliveryResult {
  accepted: boolean;    // Transport accepted the message
  immediate: boolean;   // Recipient received it right now
  reference?: string;   // Tracking ID (e.g., filename)
  error?: string;       // Error message if not accepted
}
```

For Maildir:
- `accepted` is `true` unless disk fails
- `immediate` is always `false` (queued, not live)
- `reference` is the filename in the recipient's inbox

## Maildir Transport

The Maildir transport stores messages as JSON files in a classic Maildir structure:

```
~/.pi/agents/
├── <agent-id>/
│   └── inbox/
│       ├── tmp/     # Temporary writes (in-flight)
│       ├── new/     # Unread messages
│       └── cur/     # Acknowledged messages (pruned)
```

### Message Flow

```
Sender                        Recipient
  │                               │
  │  1. Write to tmp/             │
  │  2. Rename to new/            │
  │─────────────────────────────►│
  │     (message queued)          │
  │                               │
  │                     3. Read new/ on session start
  │                     4. Process message
  │                     5. Move new/ → cur/
  │                     6. Prune cur/ (keep 50)
```

### Atomic Writes

Messages are written safely:

1. Write to `tmp/<timestamp>-<uuid>.json`
2. Rename atomically to `new/<timestamp>-<uuid>.json`

The rename is atomic on POSIX systems — no partial messages can appear.

### Message Format

Each message is a JSON file:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "from": "alice",
  "text": "Ready for review",
  "ts": 1712150400000
}
```

### Acknowledgment

After processing a message, the recipient moves it from `new/` to `cur/`. This marks it as delivered. Old messages in `cur/` are automatically pruned (keeping the last 50).

## Configuration

### Default Setup

The default configuration uses Maildir for both send and broadcast:

```typescript
import { createMessagingExtension } from "./extensions/pi-messaging.js";
import { createMaildirTransport } from "./lib/transports/maildir.js";

const maildir = createMaildirTransport();
export default createMessagingExtension({ 
  send: maildir, 
  broadcast: maildir 
});
```

### Custom Configuration

You can configure different transports per operation:

```typescript
createMessagingExtension({
  send: createMaildirTransport(),      // Durable point-to-point
  broadcast: createSocketTransport(),  // Fast, lossy broadcast
});
```

## Custom Transports

Implement the `MessageTransport` interface:

```typescript
interface MessageTransport {
  /** Send a message to a peer agent. */
  send(peer: AgentRecord, from: string, message: string): Promise<DeliveryResult>;

  /** Return all pending inbound messages, oldest first. */
  receive(agentId: string): InboundMessage[];

  /** Mark a received message as processed. */
  ack(agentId: string, messageId: string): void;

  /** Remove old acknowledged messages. */
  prune(agentId: string): void;

  /** Ensure transport is ready (create queues, dirs, etc.). */
  init(agentId: string): void;
}
```

### Example: In-Memory Transport

```typescript
class MemoryTransport implements MessageTransport {
  private queues = new Map<string, InboundMessage[]>();
  private acked = new Set<string>();

  async send(peer: AgentRecord, from: string, message: string): Promise<DeliveryResult> {
    const queue = this.queues.get(peer.id) || [];
    queue.push({ id: crypto.randomUUID(), from, text: message, ts: Date.now() });
    this.queues.set(peer.id, queue);
    return { accepted: true, immediate: true };
  }

  receive(agentId: string): InboundMessage[] {
    return (this.queues.get(agentId) || [])
      .filter(m => !this.acked.has(m.id));
  }

  ack(agentId: string, messageId: string): void {
    this.acked.add(messageId);
  }

  prune(agentId: string): void {
    const queue = this.queues.get(agentId) || [];
    this.queues.set(agentId, queue.filter(m => !this.acked.has(m.id)));
    this.acked.clear();
  }

  init(agentId: string): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }
}
```

### Example: Socket Transport

For immediate delivery without queuing:

```typescript
class SocketTransport implements MessageTransport {
  async send(peer: AgentRecord, from: string, message: string): Promise<DeliveryResult> {
    if (!peer.socket) {
      return { accepted: false, immediate: false, error: "No socket path" };
    }
    try {
      const response = await socketSend(peer.socket, { type: "cast", from, text: message });
      return { accepted: response.ok, immediate: response.ok };
    } catch (err) {
      return { accepted: false, immediate: false, error: String(err) };
    }
  }

  receive(agentId: string): InboundMessage[] {
    return []; // Sockets don't queue — messages delivered immediately or lost
  }

  ack(): void {}  // No-op
  prune(): void {}  // No-op
  init(): void {}  // No-op
}
```

## API Reference

### Tools

| Tool | Description |
|------|-------------|
| `agent_send` | Send a message to a named peer |
| `agent_broadcast` | Send to all/filtered peers |
| `agent_peek` | List agents or read an agent's log |

### Commands

| Command | Description |
|---------|-------------|
| `/send <name> <message>` | Send a message from the TUI |

### Parameters

#### agent_send

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Agent name (e.g., "alice") |
| `message` | string | Message to send |

#### agent_broadcast

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | Message to broadcast |
| `filter` | string? | Optional substring filter on agent names |

### Return Values

#### agent_send

```
Sent to alice: Ready for review
```

With details: `{ name, messageLength, immediate, reference }`

#### agent_broadcast

```
Broadcast to 3 agent(s), 3 accepted:
  ✓ alice
  ✓ bob  
  ✓ carol
```

With details: `{ sent, failed, targets }`

## Troubleshooting

### Messages Not Delivered

1. **Check peer exists:** Run `agent_peek` to see registered agents
2. **Check inbox:** Look in `~/.pi/agents/<agent-id>/inbox/new/`
3. **Check disk space:** Maildir requires disk writes
4. **Check permissions:** Ensure `~/.pi/agents/` is writable

### Duplicate Delivery

The Maildir transport is **at-least-once**. If you process a message but crash before acknowledging, you may receive it again. Design your handlers to be idempotent.

### Stale Messages

Messages in `cur/` are automatically pruned (last 50 kept). If you need older messages, copy them before the agent restarts.

## Related Documentation

- [PI-MESSAGING-ARCHITECTURE.md](./PI-MESSAGING-ARCHITECTURE.md) — Architecture and design decisions
- Agent Registry (`lib/agent-registry.ts`) — Shared IO and registry utilities
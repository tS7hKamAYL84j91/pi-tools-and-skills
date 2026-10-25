# Message Transports

Transport implementations for the Pi messaging system.

## What is a Transport?

A transport implements the `MessageTransport` interface from `../message-transport.ts`. It defines how messages are:

- **Sent** — Written to a queue, socket, database, etc.
- **Received** — Retrieved from storage
- **Acknowledged** — Marked as processed
- **Pruned** — Cleaned up after processing

## Available Transports

| Transport | File | Delivery | Use Case |
|-----------|------|----------|----------|
| Maildir | `maildir.ts` | At-least-once, durable | Default, survives crashes |

## Interface

```typescript
interface MessageTransport {
  send(peer: AgentRecord, from: string, message: string, senderId?: string, meta?: MessageMetadata): Promise<DeliveryResult>;
  receive(agentId: string): InboundMessage[];
  ack(agentId: string, messageId: string): void;
  prune(agentId: string): void;
  init(agentId: string): void;
  pendingCount(agentId: string): number;
  cleanup(agentId: string): void;
}
```

## Maildir envelope

One JSON object per file, written to `tmp/` then renamed into `new/`:

```json
{ "id": "<uuid>", "from": "alice", "text": "…", "ts": 1792310400000 }
```

Optional fields: `senderId` (canonical registry id, not proof of authentication),
`type` (`message` | `request` | `reply` | `notification`), `inReplyTo` (id of the
message being answered), and `correlationId` (opaque grouping value). These are
descriptive metadata only — they never trigger execution, permissions, scheduling,
or workflow transitions. Legacy envelopes without them remain readable and are
treated as ordinary messages.

Notes:

- Metadata strings are trimmed; empty/whitespace-only values are omitted. Stored
  metadata is accepted only as non-empty strings, `type` must be one of the
  documented values, and attachments are shape-checked per element; forged or
  unknown values are dropped.
- Receivers see the Maildir **filename** as the message `id` (`message_read` renders it as
  `id=…`); pass that value as `inReplyTo`. The envelope's embedded `id` (uuid) is internal
  and is not what a recipient ever sees.

## Adding a New Transport

1. Create a new file in this directory (e.g., `redis.ts`)
2. Implement the `MessageTransport` interface
3. Export a factory function `createXxxTransport()`
4. Register it in your messaging config:

```typescript
import { createRedisTransport } from "./lib/transports/redis.js";

createMessaging({
  send: createRedisTransport(redisClient),
  broadcast: createRedisTransport(redisClient),
});
```

## Testing

Each transport should have corresponding tests in `../../tests/`. Tests mock the underlying infrastructure (filesystem, sockets, etc.) to verify behavior without side effects.

See `maildir-transport.test.ts` for an example.
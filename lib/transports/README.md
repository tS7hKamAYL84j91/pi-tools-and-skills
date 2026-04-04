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
  send(peer: AgentRecord, from: string, message: string): Promise<DeliveryResult>;
  receive(agentId: string): InboundMessage[];
  ack(agentId: string, messageId: string): void;
  prune(agentId: string): void;
  init(agentId: string): void;
  pendingCount(agentId: string): number;
  cleanup(agentId: string): void;
}
```

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
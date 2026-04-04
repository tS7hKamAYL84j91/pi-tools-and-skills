# Maildir Transport

A durable, at-least-once message transport using the Maildir format.

## Overview

The Maildir transport stores messages as files on disk using a classic Maildir directory structure. This provides:

- **Durability** — Messages survive process crashes and system restarts
- **Atomicity** — No partial messages; writes are atomic
- **Simplicity** — Uses the filesystem; no external dependencies
- **Portability** — Works on any POSIX-compatible system

## Directory Structure

Each agent has an inbox under the registry directory:

```
~/.pi/agents/
└── <agent-id>/
    └── inbox/
        ├── tmp/    # Temporary files during write
        ├── new/    # New, unread messages
        └── cur/    # Processed messages (acknowledged)
```

### Directory Purposes

| Directory | Purpose |
|-----------|---------|
| `tmp/` | Staging area for incomplete writes |
| `new/` | Messages waiting to be delivered |
| `cur/` | Messages that have been acknowledged |

## How It Works

### Sending a Message

When you call `send(peer, from, message)`:

1. Generate a unique filename: `<timestamp>-<uuid>.json`
2. Write message to `tmp/<filename>`
3. Rename atomically to `new/<filename>`
4. Return `DeliveryResult` with `accepted: true`

```
                     ┌─────────────┐
                     │   tmp/      │
message ──write────► │ abc-123.json│
                     └──────┬──────┘
                            │
                        rename (atomic)
                            │
                            ▼
                     ┌─────────────┐
                     │   new/      │
                     │ abc-123.json│  ◄── message is now queued
                     └─────────────┘
```

The rename operation is atomic on POSIX filesystems. A message either appears completely in `new/` or not at all — no partial reads are possible.

### Receiving Messages

When an agent drains its inbox:

1. Read all `.json` files from `new/`
2. Sort by filename (timestamp ascending, oldest first)
3. Parse each file to get message contents
4. Return array of `InboundMessage` objects

```typescript
interface InboundMessage {
  id: string;    // filename (e.g., "1712150400000-uuid.json")
  from: string;  // sender's name
  text: string;  // message content
  ts: number;    // timestamp in milliseconds
}
```

### Acknowledging Messages

After processing a message:

1. Move file from `new/` to `cur/`
2. The message is now marked as delivered

```
new/abc-123.json  ──move──►  cur/abc-123.json
    (unread)                  (delivered)
```

### Pruning Old Messages

The `prune()` function keeps the last 50 messages in `cur/` and deletes older ones. This prevents unbounded disk growth while preserving recent history.

```
cur/
├── msg-001.json  ──delete──►  (removed)
├── msg-002.json  ──delete──►  (removed)
├── ...
├── msg-051.json  (kept)
└── msg-052.json  (kept)
```

## Message File Format

Each message file is JSON:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "from": "alice",
  "text": "Ready for review",
  "ts": 1712150400000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID v4 identifier |
| `from` | string | Sender's agent name |
| `text` | string | Message content |
| `ts` | number | Unix timestamp (ms) |

## API

### Creating a Transport

```typescript
import { createMaildirTransport } from "./lib/transports/maildir.js";

const transport = createMaildirTransport();
```

### Methods

#### `send(peer, from, message)`

Send a message to a peer agent.

```typescript
const result = await transport.send(peer, "alice", "Hello!");
// result = { accepted: true, immediate: false, reference: "1712150400000-uuid.json" }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `peer` | `AgentRecord` | Recipient agent |
| `from` | `string` | Sender's name |
| `message` | `string` | Message content |

Returns `Promise<DeliveryResult>`:

```typescript
interface DeliveryResult {
  accepted: boolean;   // true if written to disk
  immediate: boolean;   // always false (queued delivery)
  reference?: string;   // filename if accepted
  error?: string;       // error message if not accepted
}
```

#### `receive(agentId)`

Get all pending messages for an agent.

```typescript
const messages = transport.receive("my-agent-id");
// messages = [{ id: "1712150400000-uuid.json", from: "alice", text: "Hello!", ts: 1712150400000 }]
```

Returns `InboundMessage[]`, sorted oldest first.

#### `ack(agentId, messageId)`

Mark a message as processed.

```typescript
transport.ack("my-agent-id", "1712150400000-uuid.json");
```

Moves the file from `new/` to `cur/`.

#### `prune(agentId)`

Clean up old acknowledged messages.

```typescript
transport.prune("my-agent-id");
```

Keeps last 50 messages in `cur/`, deletes the rest.

#### `init(agentId)`

Ensure inbox directories exist.

```typescript
transport.init("my-agent-id");
```

Creates `tmp/`, `new/`, `cur/` if they don't exist.

## Delivery Semantics

### At-Least-Once

The Maildir transport provides **at-least-once delivery**:

- A message is written to disk before `send()` returns
- Messages survive crashes at any point
- A message may be delivered multiple times in rare edge cases

### When Messages Can Be Duplicated

If a recipient:
1. Reads a message from `new/`
2. Processes the message
3. Crashes before calling `ack()`

Then on restart, the message will be delivered again.

**Recommendation:** Design message handlers to be idempotent.

### When Messages Cannot Be Lost

A message cannot be lost once `send()` returns `accepted: true`. The file exists on disk in `new/` and will be found by `receive()`.

## Error Handling

### Write Failures

If disk write fails, `send()` returns:

```typescript
{ accepted: false, immediate: false, error: "Error: ENOSPC" }
```

Common causes:
- Disk full (`ENOSPC`)
- Permission denied (`EACCES`)
- Directory doesn't exist (`ENOENT`)

### Read Failures

`receive()` returns an empty array if:
- The `new/` directory doesn't exist
- No `.json` files are found
- All files fail to parse (corrupted)

Individual parse errors are silently skipped.

### Acknowledgment Failures

`ack()` is best-effort:
- If the file doesn't exist, it's silently ignored
- This handles the case where another process already moved it

## Usage in Pi Messaging

The Maildir transport is the default for both point-to-point and broadcast messaging:

```typescript
// Default configuration (lib/transports/maildir.ts → extensions/pi-panopticon/messaging.ts)
const maildir = createMaildirTransport();
export default createMessaging({ send: maildir, broadcast: maildir });
```

### Inbox Draining

The messaging extension drains the inbox at two points:

1. **Session start** — When the agent starts running
2. **Agent end** — When the agent finishes a task

```typescript
// In pi-panopticon/index.ts
pi.on("session_start", async (_event, ctx) => {
  registry.register(ctx);
  messaging.init();          // transport.init + drainInbox + fs.watch
});

pi.on("agent_end", async () => {
  registry.setStatus("waiting");
  messaging.drainInbox();
});
```

An `fs.watch` on `new/` wakes idle agents instantly when a message arrives, complementing the drain-on-idle pattern.

## Testing

See `tests/maildir-transport.test.ts` for the test suite:

- Mocks `node:fs` — no real filesystem operations
- Mocks `agent-registry.js` — no real registry access
- Tests all methods with success and failure cases

```bash
# Run transport tests
npm test -- maildir-transport
```

## Implementation Details

### File Naming

Files are named with timestamp-first sorting:

```
<unix-timestamp-ms>-<uuid-v4>.json
```

Example: `1712150400000-550e8400-e29b-41d4-a716-446655440000.json`

This ensures:
- Chronological ordering when sorted alphabetically
- No filename collisions (UUID provides uniqueness)

### Atomicity Guarantee

The key operation is:

```typescript
writeFileSync(tmpPath, content);
renameSync(tmpPath, newPath);
```

On POSIX systems, `rename()` is atomic within the same filesystem. A reader will never see a partial file — either the old name exists or the new name exists, never both simultaneously.

### Registry Integration

The Maildir transport uses the shared `REGISTRY_DIR` constant from `agent-registry.ts`:

```typescript
import { REGISTRY_DIR } from "../agent-registry.js";
```

All inbox helpers (`ensureInbox`, `inboxReadNew`, `inboxAcknowledge`, `inboxPruneCur`) are private functions within `maildir.ts`. Both registry records and Maildir queues share the same base directory (`~/.pi/agents/`).

## Limitations

1. **No cross-filesystem moves** — `rename()` fails if `tmp/` and `new/` are on different filesystems
2. **No built-in expiration** — Messages are kept until explicitly pruned
3. **No priority** — All messages are FIFO by timestamp
4. **Single machine** — Works on local filesystem only, not distributed

## See Also

- [C4-Component.md](./C4-Component.md) — Component-level architecture
- [C4-DataFlow.md](./C4-DataFlow.md) — Message send/receive sequence
- [maildir.ts](../lib/transports/maildir.ts) — Implementation
- [messaging.ts](../extensions/pi-panopticon/messaging.ts) — Messaging module
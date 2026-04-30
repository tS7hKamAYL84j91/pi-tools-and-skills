# Matrix Extension

Phone ↔ agent messaging via Matrix.

The user types in a Matrix client → message arrives via `MatrixTransport` → panopticon pokes "N new messages" → agent calls `message_read` → replies via `message_send`.

## Architecture

```text
Matrix client → Homeserver → Bot (matrix-bot-sdk)
                              ↓
                   MatrixTransport.pushInbound()
                              ↓
                   Channel registry → message_read
```

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry — lifecycle, channel registration, status bar, `/matrix` command |
| `client.ts` | matrix-bot-sdk wrapper — sync loop, message filtering, reconnection |
| `transport.ts` | `MessageTransport` implementation — buffers inbound, wraps send |
| `config.ts` | Config loader — reads `.pi/settings.json`, reads the configured token env var |
| `types.ts` | `MatrixConfig` interface |
| `bridge.ts` | MXID utility — `mxidLocalpart("@jim:server")` → `"jim"` |

## Configuration

In your workspace's `.pi/settings.json`:

```json
{
  "extensions": [".../extensions/matrix"],
  "matrix": {
    "homeserver": "https://matrix.example.net",
    "userId": "@agent-bot:matrix.example.net",
    "roomId": "!abc:matrix.example.net",
    "accessTokenEnv": "MATRIX_BOT_TOKEN",
    "trustedSenders": ["@user:matrix.example.net"],
    "channelLabel": "matrix"
  }
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `homeserver` | yes | — | Homeserver base URL |
| `userId` | yes | — | Bot's full MXID |
| `roomId` | yes | — | Primary room for replies |
| `accessTokenEnv` | yes | — | Name of an environment variable already populated by your runtime/secret manager |
| `trustedSenders` | no | `[]` (all) | MXIDs allowed to message the bot |
| `channelLabel` | no | `"matrix"` | Channel name in message attribution |
| `storagePath` | no | `~/.pi/agent/matrix-sync` | Sync state storage path |

## Room scope

The bot listens to messages from **all rooms** the bot has joined, not just `roomId`. The `trustedSenders` filter is the access-control boundary.

## Security model

Matrix messages are external input. This extension filters senders, wraps inbound messages before putting them in model context, and leaves homeserver deployment, TLS, E2EE, and token storage to the workspace/infrastructure that uses it. This package does not create accounts, mint tokens, write secrets, or install shell environment hooks.

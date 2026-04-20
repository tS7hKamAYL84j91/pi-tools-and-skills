# Matrix Extension

Phone ↔ agent messaging via a private Matrix homeserver on Tailscale.

The user types in Element X → message arrives via `MatrixTransport` → panopticon pokes "N new messages" → agent calls `message_read` → replies via `message_send`.

## Architecture

```
Phone (Element X) → Tailscale → Caddy → Continuwuity → Bot (matrix-bot-sdk)
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
| `config.ts` | Config loader — reads `.pi/settings.json`, resolves env secrets |
| `types.ts` | `MatrixConfig` interface |
| `bridge.ts` | MXID utility — `mxidLocalpart("@jim:server")` → `"jim"` |

## Configuration

In your workspace's `.pi/settings.json`:

```json
{
  "extensions": [".../extensions/matrix"],
  "matrix": {
    "homeserver": "https://coas-matrix.example.ts.net",
    "userId": "@coas-bot:coas-matrix.example.ts.net",
    "roomId": "!abc:coas-matrix.example.ts.net",
    "accessTokenEnv": "MATRIX_ACCESS_TOKEN",
    "trustedSenders": ["@jim:coas-matrix.example.ts.net"],
    "channelLabel": "matrix"
  }
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `homeserver` | yes | — | Homeserver base URL |
| `userId` | yes | — | Bot's full MXID |
| `roomId` | yes | — | Primary room for replies |
| `accessTokenEnv` | yes | — | Env var name holding the access token |
| `trustedSenders` | no | `[]` (all) | MXIDs allowed to message the bot |
| `encryption` | no | `false` | Enable E2EE (experimental — see below) |
| `channelLabel` | no | `"matrix"` | Channel name in message attribution |
| `cryptoStorePath` | no | `~/.pi/agent/matrix-crypto` | Crypto store path (only with encryption) |
| `deviceDisplayName` | no | `"CoAS Chief of Staff (extension)"` | Device display name |

## Room scope

The bot listens to messages from **all rooms** on the homeserver, not just `roomId`. On a private homeserver with only trusted users, this simplifies DM handling. The `trustedSenders` filter is the security boundary.

## Encryption

Encryption defaults to **off**. On a private Tailscale mesh, WireGuard encrypts the transport. Matrix E2EE is optional defense-in-depth.

When `encryption: true`, the bot initializes a Rust-backed crypto store. **Limitation:** matrix-bot-sdk does not support interactive device verification (SAS/emoji). Element X may not share Megolm keys with unverified bot devices. This is a known upstream issue with no fix.

## Deployment

See `~/git/coas/coas-infra/README.md` for the full Docker stack setup (Continuwuity + Caddy + Tailscale).

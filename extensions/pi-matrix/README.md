# Matrix Extension

Phone ↔ agent messaging via Matrix.

The user types or attaches files in a Matrix client → message arrives via `MatrixTransport` → panopticon pokes "N new messages" → agent calls `message_read` → replies via `message_send`.

## Architecture

```text
Matrix client → Homeserver → Bot (matrix-bot-sdk)
                              ↓
              text/media filter + safe attachment cache
                              ↓
                   MatrixTransport.pushInbound()
                              ↓
                   Channel registry → message_read
```

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry — lifecycle, channel registration, status bar, `/matrix` command |
| `client.ts` | matrix-bot-sdk wrapper — sync loop, message/media filtering, reconnection |
| `attachments.ts` | Attachment MIME/size gates, MXC download, encrypted-media helper use, cache writes |
| `transport.ts` | `MessageTransport` implementation — buffers inbound, wraps send |
| `config.ts` | Config loader — reads `.pi/settings.json`, reads the configured token env var |
| `types.ts` | `MatrixConfig` interface |
| `bridge.ts` | MXID utility — `mxidLocalpart("@jim:server")` → `"jim"` |

## Configuration

In your workspace's `.pi/settings.json`:

```json
{
  "extensions": [".../extensions/pi-matrix"],
  "pi-matrix": {
    "homeserver": "https://matrix.example.net",
    "userId": "@agent-bot:matrix.example.net",
    "roomId": "!abc:matrix.example.net",
    "accessTokenEnv": "MATRIX_BOT_TOKEN",
    "trustedSenders": ["@user:matrix.example.net"],
    "channelLabel": "matrix",
    "attachmentCachePath": "~/.pi/agent/matrix-attachments",
    "maxAttachmentBytes": 26214400,
    "allowedMimePrefixes": ["image/", "application/pdf", "text/", "audio/", "video/"]
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
| `attachmentCachePath` | no | `~/.pi/agent/matrix-attachments` | Local cache for downloaded attachments |
| `maxAttachmentBytes` | no | `26214400` | Per-attachment download/write limit |
| `allowedMimePrefixes` | no | images, PDFs, text, audio, video | MIME classes allowed for download. Entries ending in `/` match prefixes (for example `image/`); concrete entries match exactly (for example `application/pdf`). Empty array disables MIME filtering. |

## Room scope

The bot listens to messages from **all rooms** the bot has joined, not just `roomId`. The `trustedSenders` filter is the access-control boundary.

## Outbound rich-text formatting

Outbound Matrix replies are sent as standard Matrix custom-HTML messages:

```json
{
  "msgtype": "m.text",
  "body": "plain-text fallback",
  "format": "org.matrix.custom.html",
  "formatted_body": "<p>HTML fragment</p>"
}
```

The formatter accepts a Markdown subset and emits both a Matrix-safe HTML fragment and a readable plain-text fallback. Supported input includes `**bold**`, `*italic*`, `<u>underline</u>`, `~~strikethrough~~`, inline code, fenced code blocks, `#`/`##`/`###` headings, unordered lists (`-` or `*`), ordered lists (`1.`), horizontal rules (`---`), and blockquotes (`>`). Raw HTML is escaped except simple underline tags; plain-text fallback strips Markdown markers and uses readable symbols such as `•` for bullets, `›` for quotes, and `──────────` for rules.

## Attachments

Supported Matrix media message types: `m.image`, `m.file`, `m.audio`, and `m.video`.

When a trusted sender sends an image, PDF, or other allowed file, `message_read` includes metadata and a local path, for example:

```text
[22:10:00] [matrix:matrix:jim] see attached
  - attachment:image filename="photo.png" mime="image/png" size=12345 path="/home/me/.pi/agent/matrix-attachments/.../photo.png" mxc="mxc://example/media" event="$event"
```

Use the built-in `read` tool on the local path to inspect images or text/PDF files when needed.

## Security model

Matrix messages and attachments are external input. This extension filters senders, wraps inbound messages before putting them in model context, stores attachments as inert files, and never executes or parses them automatically. Keep `trustedSenders`, `maxAttachmentBytes`, and `allowedMimePrefixes` restrictive for shared rooms.

Encrypted room events require matrix-bot-sdk crypto configuration before the SDK can emit decrypted `m.room.message` events. Encrypted media blobs (`content.file`) are currently deferred because matrix-bot-sdk `decryptMedia()` downloads the encrypted blob before callers can enforce this extension's size limit; `message_read` surfaces an attachment error with the MXC/event metadata instead of silently dropping it.

## What this does NOT do

- Does not deploy or configure a Matrix homeserver.
- Does not create accounts, mint tokens, write secrets, or install shell environment hooks.
- Does not parse or execute attachments automatically.
- Does not bypass `trustedSenders`, MIME, or size gates.
- Does not own TLS, E2EE device setup, token storage, or cache cleanup policy.

This package leaves homeserver deployment, TLS, E2EE device setup, token storage, and cache cleanup policy to the workspace/infrastructure that uses it.

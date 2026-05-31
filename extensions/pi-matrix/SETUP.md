# Matrix Extension — Setup

This extension only consumes Matrix connection settings. It does **not** provision a homeserver, create Matrix accounts, mint access tokens, write secrets, or install shell environment hooks.

## 1. Prepare Matrix outside this package

In the workspace or infrastructure repo that uses this package, provide:

1. A Matrix homeserver.
2. A bot account.
3. A room the bot can read and send in.
4. A runtime/secret-manager mechanism that exposes the bot token as an environment variable before pi starts.

## 2. Configure the workspace

Add the extension and Matrix settings to that workspace's `.pi/settings.json`:

```json
{
  "extensions": ["/absolute/path/to/pi-tools-and-skills/extensions/pi-matrix"],
  "pi-matrix": {
    "homeserver": "https://matrix.example.net",
    "userId": "@agent-bot:matrix.example.net",
    "roomId": "!roomid:matrix.example.net",
    "accessTokenEnv": "MATRIX_BOT_TOKEN",
    "trustedSenders": ["@user:matrix.example.net"],
    "allowAnySender": false,
    "encryption": false,
    "channelLabel": "matrix",
    "attachmentCachePath": "~/.pi/agent/matrix-attachments",
    "maxAttachmentBytes": 26214400,
    "allowedMimePrefixes": ["image/", "application/pdf", "text/", "audio/", "video/"]
  }
}
```

## 3. Start pi from your runtime launcher

Start pi using whatever workspace/runtime wrapper provides the configured token environment variable. This package intentionally does not prescribe that mechanism.

## Sending images and PDFs to CoAS/pi

1. Send the image, PDF, audio/video, or file in the Matrix room from a trusted MXID.
2. Wait for pi to report `N new messages`.
3. The agent calls `message_read`; attachment records include filename, MIME, size, MXC URL, event id, and local cache path.
4. The agent can call `read` on image/PDF/text paths when inspection is needed.

Attachments are cached locally and are not auto-executed. Remove old files from `attachmentCachePath` according to your workspace retention policy.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `matrix: env var "NAME" is not set` | Ensure your workspace/runtime launcher or secret manager sets the env var named by `matrix.accessTokenEnv`. |
| Status bar shows `matrix: off` | Homeserver unreachable — verify URL, network, TLS, and bot credentials. |
| Status bar shows `matrix: err` | Client error — check pi logs for `matrix:` prefixed errors. |
| Messages not arriving | Verify `trustedSenders` includes your MXID and that the bot is in the room. Empty `trustedSenders` denies inbound messages unless `allowAnySender: true` is set for dev/test. |
| Attachment shows `MIME type not allowed` | Add a narrow MIME prefix/class to `allowedMimePrefixes` or send a supported file type. |
| Attachment shows `maxAttachmentBytes` | Raise the per-attachment limit only if the room and sender are trusted. |
| Encrypted attachment has no local path | Current behavior deliberately defers encrypted media blob downloads because the SDK helper cannot enforce this extension's size limit before buffering. Metadata is still shown. |
| Decryption errors | If E2EE is configured, wipe the crypto store used by that workspace and restart. |

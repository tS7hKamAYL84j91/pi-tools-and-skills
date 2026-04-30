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
  "extensions": ["/absolute/path/to/pi-tools-and-skills/extensions/matrix"],
  "matrix": {
    "homeserver": "https://matrix.example.net",
    "userId": "@agent-bot:matrix.example.net",
    "roomId": "!roomid:matrix.example.net",
    "accessTokenEnv": "MATRIX_BOT_TOKEN",
    "trustedSenders": ["@user:matrix.example.net"],
    "encryption": false,
    "channelLabel": "matrix"
  }
}
```

## 3. Start pi from your runtime launcher

Start pi using whatever workspace/runtime wrapper provides the configured token environment variable. This package intentionally does not prescribe that mechanism.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `matrix: env var "NAME" is not set` | Ensure your workspace/runtime launcher or secret manager sets the env var named by `matrix.accessTokenEnv`. |
| Status bar shows `📡 ✗` | Homeserver unreachable — verify URL, network, TLS, and bot credentials. |
| Status bar shows `📡 !` | Client error — check pi logs for `matrix:` prefixed errors. |
| Messages not arriving | Verify `trustedSenders` includes your MXID and that the bot is in the room. |
| Decryption errors | If `encryption: true`, wipe crypto store: `rm -rf ~/.pi/agent/matrix-crypto` and restart. |

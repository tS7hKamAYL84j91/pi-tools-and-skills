# Matrix Extension — Setup

Setup guide for the pi Matrix extension that bridges your phone to the agent.

## Self-hosted (recommended)

The full Docker stack (Continuwuity + Caddy + Tailscale) lives in `~/git/coas/coas-infra/`.

```bash
cd ~/git/coas
make up BOT_PASSWORD=X PERSONAL_USER=jim PERSONAL_PASSWORD=Y
```

This bootstraps:
1. Tailscale mesh identity
2. Continuwuity homeserver
3. Bot + personal Matrix accounts
4. Private room (unencrypted by default)
5. Updates `working-notes/.pi/settings.json` with room ID + config

## After bootstrap

Start the agent in the working-notes workspace:

```bash
cd ~/git/working-notes
make start    # resident zellij session
```

Install Element X on your phone, sign in to your Tailscale-hosted homeserver, and message the bot in the configured room.

## Configuration

The bootstrap script writes `working-notes/.pi/settings.json` with:

```json
{
  "matrix": {
    "homeserver": "https://coas-matrix.<tailnet>.ts.net",
    "userId": "@coas-bot:coas-matrix.<tailnet>.ts.net",
    "roomId": "!...:coas-matrix.<tailnet>.ts.net",
    "accessTokenEnv": "MATRIX_ACCESS_TOKEN",
    "trustedSenders": ["@jim:coas-matrix.<tailnet>.ts.net"],
    "encryption": false,
    "channelLabel": "matrix"
  }
}
```

The access token is resolved from the secret store at runtime via `coas-pi`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `matrix: env var "MATRIX_ACCESS_TOKEN" is not set` | Run `coas-pi` (resolves from secret store) or `export MATRIX_ACCESS_TOKEN=$(coas-secrets get matrix-token)` |
| Status bar shows `📡 ✗` | Homeserver unreachable — check `make logs` in coas, verify Tailscale is up |
| Status bar shows `📡 !` | Client error — check pi logs for `matrix:` prefixed errors |
| Messages not arriving | Verify `trustedSenders` includes your MXID, check room membership |
| Decryption errors | If `encryption: true`, wipe crypto store: `rm -rf ~/.pi/agent/matrix-crypto` and restart |

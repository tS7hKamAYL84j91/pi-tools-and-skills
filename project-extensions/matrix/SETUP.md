# Matrix Extension — Setup

Setup guide for the pi Matrix extension that bridges your phone to the Chief of Staff agent via an encrypted Matrix room.

## Self-hosted (recommended)

If using the `coas-infra/` Docker stack, **setup is automatic**. `coas-up` handles account creation, room setup, and the matrix extension connects on first start with cross-signing pre-configured.

See [coas-infra/README.md](../../coas-infra/README.md) for the one-command deployment.

After `coas-up` completes:
1. Install **Element X** on your phone
2. Sign in to `https://coas-matrix.YOUR-TAILNET.ts.net` with your personal credentials
3. The "Chief of Staff" room is already there
4. Send a message — the agent receives it via `matrix_read`

## Manual setup (matrix.org or other homeserver)

If using matrix.org or another existing homeserver instead of `coas-infra`:

### 1. Create accounts

- **Bot account** (`@coas-bot:matrix.org`) — headless, only used by the extension
- **Personal account** (`@you:matrix.org`) — your phone

### 2. Create an encrypted room

In Element X, create a private room with encryption ON and invite the bot.

### 3. Get the bot's access token

Option A: Sign in to [app.element.io](https://app.element.io) as the bot → Settings → Help & About → Access Token. Sign the bot out of Element Web after copying.

Option B: Use the login script:
```bash
npx tsx scripts/matrix-login.ts \
  --homeserver https://matrix.org \
  --user @coas-bot:matrix.org
```

### 4. Store the token

```bash
export MATRIX_ACCESS_TOKEN="syt_..."
# Add to ~/.zshrc (chmod 600) or your secrets manager
```

### 5. Configure settings.json

Add to your project's `.pi/settings.json`:
```json
{
  "extensions": [
    "/path/to/pi-tools-and-skills/project-extensions/matrix"
  ],
  "matrix": {
    "homeserver": "https://matrix.org",
    "userId": "@coas-bot:matrix.org",
    "roomId": "!your-room-id:matrix.org",
    "targetAgent": "coas",
    "accessTokenEnv": "MATRIX_ACCESS_TOKEN",
    "encryption": true,
    "cryptoStorePath": "~/.pi/agent/matrix-crypto"
  }
}
```

### 6. Start pi

```bash
cd ~/git/coas && pi
```

The extension connects, joins the room, and starts the sync loop. Cross-signing keys are uploaded automatically if `botPasswordEnv` is configured.

## Crypto store

The crypto store at `~/.pi/agent/matrix-crypto/` holds Olm/Megolm session keys and device identity. **Must survive restarts.** If wiped, the bot appears as a new device and historical encrypted messages are unreadable.

Back it up alongside `~/.pi/`.

## Troubleshooting

### "Unable to decrypt" on the phone
The bot's device isn't trusted. If using `coas-infra`, cross-signing is automatic. If manual setup, ensure `botPasswordEnv` is set so cross-signing keys can be uploaded.

### "Unable to decrypt" on the bot
The phone hasn't shared Megolm keys. This happens before cross-signing is complete. Restart the agent — cross-signing uploads happen on startup.

### Bot shows as "unverified" in Element X
Cross-signing keys may not have uploaded. Check logs for "cross-signing: keys uploaded and device signed". Ensure `botPasswordEnv` points to an env var with the bot's password.

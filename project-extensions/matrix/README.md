# Matrix Extension

End-to-end encrypted bridge between a Matrix room and a pi agent's inbox.

The user types in Element X on their phone → message arrives in the Chief of Staff's panopticon inbox tagged `[from matrix:<localpart>]`. The Chief of Staff calls `matrix_send` to reply → message appears on the phone. All E2E encrypted via the Matrix Olm/Megolm crypto stack.

For one-time setup (account creation, room creation, device verification), see [`SETUP.md`](./SETUP.md).

## Architecture

```
Element X (phone)
    │
    │ E2EE Megolm session
    │
    ▼
Matrix homeserver (matrix.org or self-hosted)
    │
    │ E2EE Megolm session
    │
    ▼
matrix-bot-sdk client (this extension)
    │
    │ bridgeInbound(msg, "coas")
    │
    ▼
lib/agent-api.sendAgentMessage(coas-id, "matrix:jim", body)
    │
    │ Maildir
    │
    ▼
Chief of Staff inbox → drainInbox → "[from matrix:jim]: ..." in prompt
```

## Files

| File | Role |
|---|---|
| `index.ts` | Extension entry point — lifecycle hooks, tool registration, `/matrix` slash command |
| `client.ts` | `matrix-bot-sdk` wrapper with E2EE crypto store, sync loop, auto-accept-room-invite, send |
| `bridge.ts` | Pure function: `InboundMessage` → `sendAgentMessage` to the target agent's inbox |
| `config.ts` | Loads + validates the `matrix` block from `~/.pi/agent/settings.json` (or project-level) |
| `types.ts` | `MatrixConfig`, `MatrixStatus` shared types |
| `SETUP.md` | One-time user setup playbook (Phase 1 matrix.org → Phase 2 E2EE → Phase 3 self-hosted) |

## Runtime contract

The extension is a **no-op if no `matrix` block is configured** in settings. Pi loads the extension but it sits idle. Useful for opting out without removing the extension from `settings.json`.

When configured, the extension:

1. **At `session_start`**: loads config, resolves the access token from the configured env var, initialises the matrix-bot-sdk client with E2EE, starts the sync loop, auto-accepts the configured room invite (and only that room).
2. **At `session_shutdown`**: stops the sync loop, releases resources.
3. **At `before_agent_start`**: injects a one-line system-prompt hint telling the chief of staff that a Matrix channel exists and how to reply.
4. **On inbound messages**: filters to the configured room, ignores its own echoes, decrypts, and routes via `bridgeInbound` → `sendAgentMessage` to the target panopticon agent.
5. **Tools**: `matrix_send`, `matrix_status`.
6. **Slash commands**: `/matrix` (status snapshot via UI notify).

## Configuration

In `~/git/coas/.pi/settings.json` (or any pi settings file):

```jsonc
{
  "extensions": [
    "/Users/jim/git/pi-tools-and-skills/project-extensions/matrix"
  ],
  "matrix": {
    "homeserver":        "https://matrix.org",
    "userId":            "@coas-bot:matrix.org",
    "roomId":            "!abc123:matrix.org",
    "targetAgent":       "coas",
    "accessTokenEnv":    "MATRIX_ACCESS_TOKEN",
    "encryption":        true,
    "deviceDisplayName": "CoAS Chief of Staff (extension)",
    "cryptoStorePath":   "~/.pi/agent/matrix-crypto",
    "secureBackupEnv":   "MATRIX_RECOVERY_PASSPHRASE"
  }
}
```

| Field | Required? | Notes |
|---|---|---|
| `homeserver` | yes | Base URL of the Matrix homeserver. Plain HTTP allowed for inside-docker-network targets. |
| `userId` | yes | Full bot MXID (`@user:server`). Validated at load time. |
| `roomId` | yes | Internal room ID starting with `!`. Validated at load time. |
| `targetAgent` | yes | Panopticon registry name to deliver inbound messages to (e.g. `coas`). |
| `accessTokenEnv` | yes | Name of the env var holding the bot's access token. **Never the literal token.** |
| `encryption` | no | Default `true`. Set `false` to disable E2EE (NOT recommended). |
| `deviceDisplayName` | no | What other Matrix devices see this session called as. |
| `cryptoStorePath` | no | Where the persistent crypto store lives. `~/` is expanded. Default: `~/.pi/agent/matrix-crypto`. |
| `secureBackupEnv` | no | Env var name for the optional Secure Backup recovery passphrase. |

## Secrets

The extension only ever reads secrets from environment variables. Recommended secret stores:

| Platform | Backend | Wrapper script |
|---|---|---|
| macOS | login Keychain via `security` | `pi-tools-and-skills/scripts/coas-secrets.sh` |
| Linux | `pass` (passwordstore.org) | `pi-tools-and-skills/scripts/coas-secrets.sh` |

Add a secret:
```bash
echo 'syt_abc123' | scripts/coas-secrets.sh set matrix-token
```

Read it (used by `coas-up` to populate env before docker compose):
```bash
export MATRIX_ACCESS_TOKEN="$(scripts/coas-secrets.sh get matrix-token)"
```

For first-time bot account provisioning (or token rotation), use:
```bash
npx tsx scripts/matrix-login.ts \
  --homeserver https://matrix.org \
  --user @coas-bot:matrix.org
# Prompts for password, prints token. Pipe into coas-secrets to store.
```

## Tools

### `matrix_send`

Send an end-to-end encrypted message to the configured room.

```jsonc
{
  "name": "matrix_send",
  "parameters": { "message": "string" }
}
```

The chief of staff uses this to reply to inbound `[from matrix:...]` messages, push status updates, or notify the human.

### `matrix_status`

Report bridge connection state, last-sync age, room/agent info. Used by the chief of staff to self-diagnose.

## Inbound flow (the part nobody else does)

When a message arrives in the configured room:

1. **Sync loop** receives the encrypted event from the homeserver
2. **matrix-bot-sdk** decrypts it using the room's Megolm session keys (which were established when the bot joined the room and verified the human's device)
3. **Filter**: the wrapper drops events that aren't `m.room.message` `m.text`, that originate from the bot itself (echo prevention), or that arrived in a room other than the configured one
4. **Bridge**: `bridgeInbound` calls `findAgentByName(targetAgent)` to look up the chief of staff in the panopticon registry. If not running, the bot replies in-room saying so.
5. **Delivery**: `sendAgentMessage(agent.id, "matrix:<localpart>", body)` posts the message to the agent's Maildir inbox
6. **Inbox drain**: panopticon's `messaging.drainInbox` (already running for `agent_send`) picks up the new message on its next loop and surfaces it to the chief of staff as `pi.sendUserMessage("[from matrix:jim]: ...", { deliverAs: "followUp" })`

The chief of staff agent treats this exactly like any other peer-agent message — same trust level, same prompt format, same tooling.

## Outbound flow

When the chief of staff calls `matrix_send`:

1. **Tool execution** invokes `client.send(text)` on the wrapper
2. **matrix-bot-sdk** encrypts the message using the room's Megolm session
3. **Sync loop** publishes the event to the homeserver
4. **Phone** receives the event via its own sync, decrypts, displays in Element X
5. **Tool result** returns `{eventId, roomId}` so the chief of staff has a stable handle for future references

## Security model

See `SETUP.md` for the full threat model and the Phase 1/2/3 progression.

Brief summary for runtime:
- **Token is a bearer credential** — anyone who captures `MATRIX_ACCESS_TOKEN` can impersonate the bot. Treat it like an SSH private key.
- **Crypto store is also sensitive** — it contains Megolm session keys. If the file is leaked, an attacker could decrypt historical messages. Store it on an encrypted filesystem.
- **Inbound messages are user input to the chief of staff** — the room ACL (private, invite-only, just you and the bot) is the only authentication. Anyone in the room can issue commands.
- **The bridge has no rate limiting** — a flood of inbound messages will fan out to the inbox. Trust the room ACL.
- **No retention of decrypted content in extension state** — bridged messages flow through `bridgeInbound` and are discarded by the extension. Persistence is the agent's responsibility.

## Tests

Unit tests in `tests/matrix-extension.test.ts` cover:

- `mxidLocalpart` — MXID parsing
- `bridgeInbound` — delivered / no-agent / failed paths via mocked `lib/agent-api`
- `loadMatrixConfig` — required fields, MXID/roomID validation, env var resolution, defaults, optional fields

The matrix-bot-sdk client itself is **not** unit tested — that needs a real homeserver. Integration verification happens manually via SETUP.md Phase 2.

## Deployment

This extension is the application layer. The deployment layer (Docker, Continuwuity homeserver, Tailscale sidecar) lives in `~/git/coas/infra/` — see the README there for the docker-compose stack and ops workflow.

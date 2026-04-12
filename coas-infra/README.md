# CoAS Stack — Self-hosted Matrix + Chief of Staff (Docker)

End-to-end deployment guide for running the **Chief of Staff agent** (pi + extensions), a private **Matrix homeserver** (Continuwuity), a **Caddy reverse proxy**, and a **Tailscale node** as four containers on one host. Phone (Element X) reaches the agent through an encrypted Matrix room over Tailscale. No public internet exposure.

This document is the complete walkthrough — read top to bottom on a fresh host.

---

## TL;DR

```bash
# After completing the setup walkthrough below:
cd ~/git/coas/infra

# Foreground supervised mode (recommended) — runs the stack in your
# shell, supervises container health, restarts failed containers,
# gracefully tears down on Ctrl+C:
./scripts/coas-stack

# In another terminal, attach to pi:
./scripts/coas-attach

# In pi:
/matrix                  # check the Matrix bridge status
matrix_send "hello from chief of staff"
                         # → message arrives on your phone via Element X
```

For the simpler "fire-and-forget detached" mode (e.g. if you're running this from a systemd unit and want detach-on-exit):

```bash
./scripts/coas-up        # docker compose up -d, then return immediately
# ... do stuff ...
./scripts/coas-down      # stop the stack when done
```

Day-to-day: open Element X on your phone, type a message into the Chief of Staff room, the agent's inbox surfaces it as `[from matrix:jim]: ...` and the chief of staff can reply via `matrix_send`. All E2E encrypted via Megolm.

---

## What you get

| Capability                            | How                                                  |
| ------------------------------------- | ---------------------------------------------------- |
| **Send messages from agent → phone**  | `matrix_send` tool inside pi                         |
| **Send messages from phone → agent**  | Type in Element X, lands in `coas` inbox             |
| **End-to-end encryption**             | Olm/Megolm via matrix-bot-sdk's Rust crypto          |
| **No public attack surface**          | Tailscale-only access, no port forwarding            |
| **No third-party can read content**   | You own the homeserver                               |
| **No metadata leakage to matrix.org** | You don't use matrix.org at all                      |
| **Survives container rebuilds**       | All state in named volumes + bind mounts             |
| **Portable across hosts**             | `docker compose down && rsync && up` on the new host |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Host (your Mac for dev, DGX Linux box for prod)                   │
│                                                                    │
│  coas-net (docker bridge) ───────────────────────────────────┐     │
│                                                              │     │
│   ┌──────────────────────────┐                               │     │
│   │ tailscale (netns owner)  │                               │     │
│   │ ┌──────────────────────┐ │   ┌──────────────────────┐    │     │
│   │ │ caddy                │ │   │ continuwuity         │    │     │
│   │ │ :443 (TLS, .well-    │─┼──▶│ :8008                │    │     │
│   │ │  known, /_matrix/*)  │ │   │ Matrix homeserver    │    │     │
│   │ └──────────────────────┘ │   └──────────────────────┘    │     │
│   └─────────────┬────────────┘            ▲                  │     │
│                 │                         │                  │     │
│                 │              ┌──────────┴──────────┐       │     │
│                 │              │ coas-agent          │       │     │
│                 │              │ (pi + extensions)   │       │     │
│                 │              │ ext: matrix         │       │     │
│                 │              │ → continuwuity:8008 │       │     │
│                 │              └─────────────────────┘       │     │
│                 │                                            │     │
│  ───────────────┼────────────────────────────────────────────┘     │
└─────────────────┼──────────────────────────────────────────────────┘
                  │
                  ▼
            ┌─────────────────────────┐
            │  Tailnet (private mesh) │
            │  via *.ts.net hostname  │
            └────────────┬────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  Phone          │
                │  Element X      │
                │  (E2EE)         │
                └─────────────────┘
```

### Four services

| Service          | Image                                                   | Role                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tailscale**    | `tailscale/tailscale:latest`                            | Netns owner. Joins `coas-net` AND provides the tailnet identity. Persistent state in `tailscale-state` volume. Cap_add NET_ADMIN + NET_RAW for tun.                                                                                                                                                                                                                                                                     |
| **caddy**        | `caddy:2-alpine`                                        | Sits in tailscale's netns via `network_mode: service:tailscale`. Inherits both the tailnet identity and `coas-net` access. Uses Caddy's tailscale cert provider (via the shared `tailscale-sock` volume) to fetch a real TLS cert for the `*.ts.net` hostname. Serves `/.well-known/matrix/{client,server}` as static JSON. Reverse-proxies `/_matrix/*` to `continuwuity:8008`. The only :443 listener on the tailnet. |
| **continuwuity** | `ghcr.io/continuwuity/continuwuity:latest`              | Lightweight Rust Matrix homeserver, RocksDB-backed, ~100 MB RAM. Normal `coas-net` member with stable container DNS name. Never directly exposed to the tailnet — Caddy is the only public face.                                                                                                                                                                                                                        |
| **coas-agent**   | `coas-agent:local` (built from `Dockerfile.coas-agent`) | Node 22 + pi-coding-agent + matrix-bot-sdk. Bind-mounts `~/git/` and `~/.pi/`. Reaches the homeserver via docker DNS at `continuwuity:8008`. Interactive — attach via `coas-attach`.                                                                                                                                                                                                                                    |

### Bind mounts

| Host path | Container path   | Why                                                                                                                                                                                                                                                               |
| --------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/git/`  | `/workspace`     | All git repos under one mount. The chief of staff can reach `/workspace/coas`, `/workspace/tools-and-skills`, `/workspace/personal-research`, `/workspace/working-notes`, or anything else under `~/git/`. Workers spawned in any repo get a normal git workflow. |
| `~/.pi/`  | `/home/coas/.pi` | Agent registry, kanban state, machine memories, sessions, **and the Matrix crypto store** (`~/.pi/agent/matrix-crypto/`). Persists across container rebuilds. Accessible from the host for backup.                                                                |

**No system files are bind-mounted.** No `~/.ssh`, no `~/.gitconfig`, no `/Users`, no `/home` outside the two paths above.

Override via `.env` if your layout differs:
```bash
GIT_ROOT=/custom/path/to/git
PI_STATE_DIR=/custom/path/to/pi
```

### Network model

- **Inside the docker network**: `coas-agent` and `caddy` both reach `continuwuity` at `http://continuwuity:8008` via docker DNS. Caddy can do this because it shares tailscale's netns, and tailscale is on `coas-net` — caddy inherits docker bridge access through tailscale's interfaces.
- **From the phone**: Element X reaches `https://${TS_FQDN}` via Tailscale's mesh. Caddy listens on `:443` inside tailscale's netns, terminates TLS using a cert fetched from `tailscaled` via the shared Unix socket, and proxies to `continuwuity:8008` over the docker bridge.
- **No public internet access** to the homeserver. No host port is exposed; only the tailnet can reach Caddy, only Caddy can reach Continuwuity.
- **No federation**. `allow_federation = false` in continuwuity.toml. Port 8448 never exposed. `/.well-known/matrix/server` returns `{}` defensively in case anyone scans for it.

The bot's MXIDs are scoped to the public-facing hostname (e.g. `@coas-bot:coas-matrix.tail12345.ts.net`), but the bot connects via `http://continuwuity:8008`. matrix-bot-sdk separates the connection URL from the MXID server name and handles this transparently.

---

## Prerequisites

Before starting the setup walkthrough below, you need:

### On the host (your Mac or the DGX)

| Tool                    | Why                                 | Install (macOS)            | Install (Linux DGX)                             |
| ----------------------- | ----------------------------------- | -------------------------- | ----------------------------------------------- |
| Docker + docker-compose | Run the stack                       | Docker Desktop             | `apt install docker.io docker-compose-plugin`   |
| `git`                   | Clone the repos                     | `xcode-select --install`   | `apt install git`                               |
| `curl`                  | One-shot Matrix `/register` calls   | Pre-installed              | `apt install curl`                              |
| Secret store backend    | Hold three secrets out of plaintext | Pre-installed (`security`) | `apt install pass gnupg2`                       |
| `gpg` key (Linux only)  | Required by `pass`                  | n/a                        | `gpg --gen-key` (one-time, keep the passphrase) |

### On your phone

| App           | Where                  | What it does                                             |
| ------------- | ---------------------- | -------------------------------------------------------- |
| **Tailscale** | App Store / Play Store | Joins your tailnet so the phone can reach the homeserver |
| **Element X** | App Store / Play Store | Matrix client. Newer/cleaner than legacy Element.        |

### Accounts

| Service       | Why                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------ |
| **Tailscale** | Free tier is enough. Sign up at [tailscale.com](https://tailscale.com) with GitHub/Google/email. |

You do **not** need a matrix.org account. You're running your own homeserver — accounts live there.

### Repos cloned to the host

```bash
mkdir -p ~/git
cd ~/git
git clone <YOUR_REMOTE>/coas.git
git clone <YOUR_REMOTE>/tools-and-skills.git
```

The deployment expects both repos under `~/git/`. The bind mount maps `~/git → /workspace` inside the coas-agent container.

You also need to install matrix-bot-sdk in tools-and-skills (the matrix extension's runtime dependency):
```bash
cd ~/git/tools-and-skills
npm install
```

---

# Setup walkthrough

This is a one-time setup. After completing it, day-to-day use is just `coas-up` / `coas-attach`. Most steps take a few minutes. Total: ~90 minutes including Tailscale setup, Element X setup, and the device verification dance.

If you need to stop partway through, each step has a clear "you should now have…" outcome so you can resume cleanly.

---

## Step 1 — Install Tailscale on the host and the phone

### Host

**macOS:**
```bash
brew install tailscale
sudo tailscale up
```

A browser opens for sign-in. After login, the host joins your tailnet.

**Linux DGX:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Same browser flow.

Verify:
```bash
tailscale status
tailscale ip -4    # should print a 100.x.y.z address
```

### Phone

Install the Tailscale app from your phone's app store, sign in with the same account, toggle the VPN on. The phone joins your tailnet.

### Enable MagicDNS and HTTPS certificates

Open [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns):

- **MagicDNS** — turn ON if not already (default in new accounts)
- **HTTPS Certificates** — turn ON. This lets Caddy fetch real TLS certs for `*.ts.net` hostnames via the tailscaled socket.

Find your tailnet's MagicDNS name in the same admin page — something like `tail12345.ts.net`. Combined with the hostname your CoAS box will advertise (default `coas-matrix`), the full hostname is e.g. `coas-matrix.tail12345.ts.net`. **Write this down — you'll need it as `TS_FQDN`.**

### You should now have

- ✅ Tailscale running on the host (`tailscale status` shows the host)
- ✅ Tailscale running on the phone (the phone shows up in `tailscale status` from the host)
- ✅ MagicDNS + HTTPS Certificates enabled
- ✅ Your `TS_FQDN` written down somewhere (e.g. `coas-matrix.tail12345.ts.net`)

---

## Step 2 — Generate a Tailscale auth key for the container

The Tailscale container needs an auth key to join your tailnet on first boot. Without this, it'd require interactive login which doesn't work in a headless container.

In the [Tailscale admin → Keys](https://login.tailscale.com/admin/settings/keys):

1. Click **Generate auth key**
2. **Reusable** — ON (the container can re-auth on rebuild)
3. **Ephemeral** — OFF (the node identity persists)
4. **Pre-approved** — ON (auto-approve when the node joins)
5. **Tags** — `tag:coas` (must be defined in your tailnet ACLs first; if you don't have ACLs configured, leave tags blank)
6. **Expiry** — 90 days

Copy the key. It starts with `tskey-auth-...`. **Treat it like a password.**

### You should now have

- ✅ A Tailscale auth key on your clipboard, ready to paste into your secret store

---

## Step 3 — Set up the host secret store

We never put secrets in plaintext files. Three secrets will live in your platform's native secret store: the Tailscale auth key, the Matrix bot access token, and (optionally) the Secure Backup recovery passphrase.

### macOS — Keychain

The `security` CLI is pre-installed. The `coas-secrets.sh` wrapper auto-detects macOS and uses Keychain.

Test it:
```bash
~/git/tools-and-skills/scripts/coas-secrets.sh --help
```

Should show the usage. The backend line should say `macOS → login Keychain`.

### Linux DGX — `pass`

`pass` (passwordstore.org) is a gpg-backed secret store. Headless-friendly, no D-Bus or desktop session needed.

```bash
sudo apt install -y pass gnupg2

# One-time gpg key generation if you don't already have one
gpg --gen-key
# Use defaults; pick a passphrase you'll remember (or leave it empty for headless)

# Find the key ID
gpg --list-secret-keys --keyid-format=long
# Look for: sec   rsa3072/<KEY_ID> 2026-04-11 [SC]

# Initialise pass with your key
pass init <KEY_ID>
```

Test it:
```bash
~/git/tools-and-skills/scripts/coas-secrets.sh --help
```

Backend line should say `Linux → pass`.

### Store the Tailscale auth key

```bash
echo 'tskey-auth-PASTE-YOUR-KEY-HERE' | \
  ~/git/tools-and-skills/scripts/coas-secrets.sh set tailscale-authkey
```

Verify:
```bash
~/git/tools-and-skills/scripts/coas-secrets.sh get tailscale-authkey
# Should print: tskey-auth-...
```

You'll add `matrix-token` later (Step 8) once the bot account exists. The optional `matrix-recovery` (for Secure Backup) is added in Step 14 if you choose to set it up.

### You should now have

- ✅ A working secret store backend on the host
- ✅ `tailscale-authkey` stored, retrievable via `coas-secrets get tailscale-authkey`

---

## Step 4 — Configure Continuwuity's `server_name`

The `server_name` in continuwuity.toml MUST match the hostname Element X uses to reach the homeserver. **This is one-way** — once Continuwuity has stored its first event with a given `server_name`, you can't change it without wiping the database.

Edit `~/git/coas/infra/config/continuwuity.toml`:

```toml
server_name = "coas-matrix.tail12345.ts.net"   # ← your TS_FQDN from Step 1
```

Save the file.

### You should now have

- ✅ `continuwuity.toml` with the correct `server_name`

---

## Step 5 — Create `.env` (only TS_FQDN and TS_HOSTNAME, no secrets)

```bash
cd ~/git/coas/infra
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```bash
TS_HOSTNAME=coas-matrix
TS_FQDN=coas-matrix.tail12345.ts.net    # same as continuwuity.toml server_name
```

Leave the secret lines (`MATRIX_ACCESS_TOKEN`, `TS_AUTHKEY`, etc.) commented out — `coas-up` resolves them from the secret store at compose time.

### You should now have

- ✅ `infra/.env` with `TS_HOSTNAME` and `TS_FQDN` set, `chmod 600`

---

## Step 6 — First boot: just the homeserver, to provision accounts

Bring up Continuwuity and Tailscale, but NOT the coas-agent yet (because we don't have the matrix bot token until after we register the bot account).

```bash
cd ~/git/coas/infra
./scripts/coas-up continuwuity tailscale caddy
```

The `coas-up` wrapper resolves your secrets from the store and runs `docker compose up -d` for those three services.

Wait a moment for Continuwuity to initialise the database, then check logs:

```bash
docker compose logs continuwuity
```

You should see something like:
```
Welcome to Continuwuity 0.5.6 ...
In order to use your new homeserver, you need to create its first user account.
Open your Matrix client of choice and register an account on coas-matrix.tail12345.ts.net
using the registration token <RANDOM_TOKEN>
Registration has been temporarily enabled to allow you to create an account.
```

**Continuwuity auto-generates a registration token and temporarily enables registration on first boot when no users exist.** Copy that random token from the logs — you'll use it in Step 8.

### Verify Tailscale picked up the homeserver

In the [Tailscale admin → Machines](https://login.tailscale.com/admin/machines), look for a new device named `coas-matrix` (or whatever your `TS_HOSTNAME` is). It should be online.

### Verify Caddy is serving on the tailnet

From your host (already on the tailnet from Step 1):
```bash
curl https://coas-matrix.tail12345.ts.net/_matrix/client/versions
```

Should return JSON listing all supported Matrix client API versions, including `e2e_cross_signing: true`.

If you get a TLS error or connection refused, check:
- Tailscale HTTPS Certificates is enabled (Step 1)
- The Tailscale container has authed (`docker compose logs tailscale`)
- Caddy is running (`docker compose ps`)
- The hostname in your URL matches `TS_FQDN` exactly

### From your phone

In the phone's browser, open the same URL: `https://coas-matrix.tail12345.ts.net/_matrix/client/versions`. You should get the same JSON. If the phone can't reach it, check that the phone's Tailscale VPN toggle is ON.

### You should now have

- ✅ Continuwuity, Caddy, and Tailscale containers running
- ✅ The auto-generated registration token copied from the Continuwuity logs
- ✅ The homeserver reachable via Caddy from both the host AND the phone over the tailnet

---

## Step 7 — Create the bot account

The bot is the Matrix identity the extension logs in as. It's separate from your personal account.

```bash
# Replace <TOKEN> with the registration token from the Continuwuity logs in Step 6
# Replace <BOT_PASSWORD> with a strong password — store it in your password manager

curl -X POST https://coas-matrix.tail12345.ts.net/_matrix/client/v3/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "coas-bot",
    "password": "<BOT_PASSWORD>",
    "auth": {
      "type": "m.login.registration_token",
      "token": "<TOKEN>"
    }
  }'
```

Successful response (formatted):
```json
{
  "user_id": "@coas-bot:coas-matrix.tail12345.ts.net",
  "access_token": "syt_Y29hcy1ib3Q_...",
  "home_server": "coas-matrix.tail12345.ts.net",
  "device_id": "ABCDEFGHIJ"
}
```

### Store the bot's access token

```bash
echo 'syt_Y29hcy1ib3Q_...' | \
  ~/git/tools-and-skills/scripts/coas-secrets.sh set matrix-token
```

Verify:
```bash
~/git/tools-and-skills/scripts/coas-secrets.sh get matrix-token
# Should print: syt_...
```

### You should now have

- ✅ A Matrix bot account `@coas-bot:<TS_FQDN>` exists on Continuwuity
- ✅ The bot's access token stored in `coas-secrets` as `matrix-token`
- ✅ The bot's password recorded in your password manager (for token rotation later)

---

## Step 8 — Create your personal account

Same registration token, different username. **Use it within a few minutes** — Continuwuity will close registration as soon as you have one user (the bot from Step 7), so the registration token stops working. If it's already closed, see "Re-enabling registration" in the troubleshooting section.

Actually — Continuwuity behaviour: registration stays temporarily enabled until **the admin creates the registration token explicitly** in config OR until the first user is created. Since the bot was just created, registration may already be closed. If your second `curl` returns `M_FORBIDDEN`, you need to either:
- Restart Continuwuity (it'll re-enable registration only if it sees no users — but the bot exists, so this won't help)
- Set a registration token explicitly in `continuwuity.toml`

The easier path: **set an explicit registration_token in continuwuity.toml**, restart, register both accounts, then remove the token. Edit `~/git/coas/infra/config/continuwuity.toml`:

```toml
allow_registration = false
registration_token = "PASTE_THE_TOKEN_FROM_STEP_6_HERE"
```

Restart:
```bash
cd ~/git/coas/infra
docker compose restart continuwuity
```

Now register your personal account:

```bash
curl -X POST https://coas-matrix.tail12345.ts.net/_matrix/client/v3/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "jim",
    "password": "<PERSONAL_PASSWORD>",
    "auth": {
      "type": "m.login.registration_token",
      "token": "PASTE_THE_TOKEN_FROM_STEP_6_HERE"
    }
  }'
```

**After both accounts exist, remove the registration_token line** from `continuwuity.toml` and restart:

```bash
docker compose restart continuwuity
```

This closes registration for good. No one else can create accounts.

### You should now have

- ✅ Two Matrix accounts on your homeserver: `@coas-bot:<TS_FQDN>` and `@jim:<TS_FQDN>`
- ✅ Registration closed (no `registration_token` in continuwuity.toml)

---

## Step 9 — Sign in to Element X on your phone

1. Open Element X on your phone
2. Tap **Edit homeserver** (or "Change server" — wording varies)
3. Enter `https://coas-matrix.tail12345.ts.net` (your `TS_FQDN`)
4. Element X should detect the homeserver and let you proceed
5. Username: `jim` (Element fills in `@jim:<TS_FQDN>`)
6. Password: the one from Step 8

You should land in your (empty) Element X account. No rooms yet — this is a fresh homeserver.

### You should now have

- ✅ Element X on your phone signed in as `@jim:<TS_FQDN>`

---

## Step 10 — Create the encrypted room and invite the bot

In Element X:

1. Tap the **+** button → **Create room**
2. **Name**: "Chief of Staff" (or anything recognisable)
3. **Privacy**: **Private**
4. **Encryption**: **ON** — critical. You can't disable encryption on a Matrix room after creation, so get this right at creation time
5. **Invite**: type the bot's full MXID (`@coas-bot:coas-matrix.tail12345.ts.net`). Element may not autocomplete it — type it by hand
6. Tap create

### Get the internal room ID

The room ID is what the matrix extension's config needs.

- Tap the room name at the top → scroll to room settings
- Look for **Advanced** → **Internal room ID** (or similar)
- Copy the value. It looks like `!abcdefghijk:coas-matrix.tail12345.ts.net`. The `!` is part of the ID.

### You should now have

- ✅ A private encrypted room on your homeserver containing you and an invited (not-yet-joined) bot
- ✅ The room ID copied somewhere — it's `!abc:<TS_FQDN>` shape

---

## Step 11 — Configure the matrix extension

Edit `~/git/coas/.pi/settings.json`. Add a `matrix` block alongside the existing `extensions` array:

```jsonc
{
  "extensions": [
    "/workspace/tools-and-skills/project-extensions/kanban",
    "/workspace/tools-and-skills/project-extensions/matrix"
  ],
  "matrix": {
    "homeserver":        "http://continuwuity:8008",
    "userId":            "@coas-bot:coas-matrix.tail12345.ts.net",
    "roomId":            "!abc:coas-matrix.tail12345.ts.net",
    "targetAgent":       "coas",
    "accessTokenEnv":    "MATRIX_ACCESS_TOKEN",
    "encryption":        true,
    "deviceDisplayName": "CoAS Chief of Staff (extension)",
    "cryptoStorePath":   "~/.pi/agent/matrix-crypto"
  }
}
```

Notes:

- **`homeserver` is the in-container URL** (`http://continuwuity:8008`), not the public-facing tailnet hostname. The bot connects to Continuwuity over the docker network, plain HTTP, no TLS overhead.
- **`userId` MUST be the public-facing MXID** (`@coas-bot:<TS_FQDN>`). The MXID's server name part identifies the homeserver's identity, regardless of how the bot connects to it.
- **`roomId` is the `!abc:<TS_FQDN>`** from Step 10.
- **`accessTokenEnv` is the env var name**, not the literal token. The token stays in `coas-secrets`.
- **Extension paths use `/workspace/...`** because pi runs inside the coas-agent container and sees `~/git/` as `/workspace/`.

Save the file.

### You should now have

- ✅ `coas/.pi/settings.json` with a complete `matrix` block

---

## Step 12 — Bring up the full stack

```bash
cd ~/git/coas/infra
./scripts/coas-down       # stop the homeserver-only services from Step 6
./scripts/coas-up         # bring up all 4 services
```

`coas-up` resolves all secrets from the store, exports them as env vars, and runs `docker compose up -d` for the full stack.

Verify all four containers are running:
```bash
docker compose ps
```

Expected:
```
NAME                   IMAGE                                       STATUS
infra-caddy-1          caddy:2-alpine                              Up
infra-coas-agent-1     coas-agent:local                            Up
infra-continuwuity-1   ghcr.io/continuwuity/continuwuity:latest   Up
infra-tailscale-1      tailscale/tailscale:latest                  Up
```

### You should now have

- ✅ Four containers running, no restart loops, no error logs

---

## Step 13 — Attach to pi inside coas-agent and verify the matrix extension loaded

```bash
./scripts/coas-attach
```

This is `docker compose exec -it coas-agent pi`. You should see pi's TUI. The status bar should show:

```
📡 🔒 matrix: connected, last sync 0s ago
```

(The 🔒 padlock indicates encryption is enabled.)

Run the slash command:
```
/matrix
```

Should report:
```
Matrix: connected as @coas-bot:coas-matrix.tail12345.ts.net, last sync 5s ago, encryption ON
```

If it says **disconnected** or **error**, check:
```bash
# In another terminal on the host:
docker compose logs coas-agent | grep -i matrix
```

Common causes:
- `accessTokenEnv` env var not set inside the container — check `coas-secrets get matrix-token` on the host returns the right value, then `coas-down && coas-up` to re-resolve
- `userId` MXID doesn't match what's actually registered on Continuwuity — typo in `settings.json`
- `roomId` doesn't exist or the bot wasn't invited — check Element X room members

### Auto-accept the invite

The matrix extension auto-accepts the bot's pending invite to the configured room on first connect. Check Element X — the bot should now show as a **member** of the room (not "invited"). If it's still showing as "invited", the auto-accept didn't fire — check the matrix extension logs.

### You should now have

- ✅ Pi running inside the coas-agent container
- ✅ Matrix extension status: connected, encryption ON
- ✅ The bot has joined the Chief of Staff room (visible in Element X room members list)

---

## Step 14 — First-run device verification (THIS is when E2EE actually starts working)

Until you complete this step, encrypted messages between you and the bot show up as **"unable to decrypt"** on both sides. The verification dance is what tells your phone "yes, that bot device's keys are legitimate".

When the matrix extension started for the first time in Step 12, matrix-bot-sdk created a new Matrix device for the bot with fresh Olm/Megolm keys. Element X sees this as an **unverified session**.

### From your phone (Element X)

1. Open the Chief of Staff room
2. Tap the room name at the top → **People** (or "Members")
3. Tap `@coas-bot:<TS_FQDN>` → tap **Sessions** (or "Devices")
4. You'll see one device labelled **CoAS Chief of Staff (extension)** with an "unverified" warning
5. Tap **Verify**

Element X will show one of:
- **Emoji-matching dance** — a sequence of emojis to compare. Both sides (the bot and your phone) need to see the same emojis. The bot side surfaces these via pi's UI, OR the matrix extension can be configured to print them at startup.
- **Security code** — a short string to compare.

⚠️ **Heads-up**: matrix-bot-sdk's verification flow is mostly automated. The simplest way to verify is to mark the device as trusted manually from your phone — Element X has a "Trust" or "Verify manually" option that skips the emoji dance for cases where you have out-of-band assurance that the device is yours.

If your Element X doesn't offer manual verification, you may need to use the headless verification flow:

```bash
# In a second terminal, attach to pi and run the matrix verify command
./scripts/coas-attach
```

Then in pi:
```
/matrix verify
```

This will print the verification SAS (the emoji or short code). Compare with what your phone shows. Confirm on both sides.

After verification, Element X should show the bot's device with a green check mark. The "unverified session" warning disappears.

### Optional: Set up Secure Backup (key recovery)

If you want to protect against losing the bot's crypto store (e.g. accidental wipe of `~/.pi`), enable Element X's Secure Backup to store the room's session keys encrypted on the homeserver:

1. In Element X: **Settings → Encryption → Secure Backup → Set up**
2. Element X prompts for a recovery passphrase. Pick a strong one. Save it in your password manager.
3. Element X may also generate a recovery key as a fallback — save that too.

If you want the bot to also be able to recover from key loss, store the recovery passphrase in `coas-secrets`:
```bash
echo 'your-recovery-passphrase' | \
  ~/git/tools-and-skills/scripts/coas-secrets.sh set matrix-recovery
```

And add to `coas/.pi/settings.json`:
```jsonc
"matrix": {
  ...,
  "secureBackupEnv": "MATRIX_RECOVERY_PASSPHRASE"
}
```

Then `coas-down && coas-up`. The bot will pull keys from the backup on subsequent starts.

If you skip this, you accept that wiping the crypto store means losing access to historical encrypted messages on the bot side. New messages will work fine (after re-verifying the new device).

### You should now have

- ✅ The bot's device verified — Element X shows it with a green check mark
- ✅ (Optional) Secure Backup enabled, recovery passphrase saved

---

## Step 15 — End-to-end test

The whole point. Round-trip an encrypted message both ways.

### Phone → Agent

1. On your phone, open the Chief of Staff room in Element X
2. Type `hello chief`
3. Send

Within a few seconds, in pi inside the coas-agent container, the chief of staff's prompt should surface:

```
[from matrix:jim]: hello chief
```

If you see this, **the inbound bridge works**. The encrypted message arrived via the sync loop, was decrypted by matrix-bot-sdk's crypto layer, was passed to `bridgeInbound`, was delivered via `sendAgentMessage` to the chief of staff's panopticon inbox, and was surfaced by pi's inbox-drain loop.

### Agent → Phone

In pi, ask the chief of staff to reply via the matrix tool:
```
matrix_send "hello jim, the bridge works"
```

The tool result should report:
```
Sent to !abc:coas-matrix.tail12345.ts.net (event $...)
```

Within a few seconds, **the message appears in Element X on your phone**. Decrypted, shown in the room as `@coas-bot`.

If both directions work, **you're done with setup**. The system is operational.

### You should now have

- ✅ Bidirectional encrypted messaging between your phone and the chief of staff
- ✅ All four containers running healthy
- ✅ All state persisted across `coas-down` / `coas-up` cycles

---

# Day-to-day operations

## Common commands

```bash
cd ~/git/coas/infra

# Two ways to bring up the stack — pick one:

./scripts/coas-stack      # SUPERVISED foreground mode
                          # - Resolves secrets from secret store
                          # - Brings up all 4 containers
                          # - Streams `docker compose logs -f` to stdout
                          # - Watches container health every 15s and restarts
                          #   failed services (max 3 restarts in 5 min, then
                          #   gives up to prevent restart loops)
                          # - Gracefully shuts down everything on Ctrl+C / SIGTERM
                          # - Suitable for interactive use AND systemd ExecStart

./scripts/coas-up         # DETACHED mode (simpler)
                          # - Resolves secrets, runs `docker compose up -d`
                          # - Returns immediately
                          # - Use ./scripts/coas-down to stop
                          # - Use ./scripts/coas-logs to tail
                          # - No supervisor — relies on docker compose's
                          #   own restart: unless-stopped policy

# Other:
./scripts/coas-down       # stop the stack (state persists in volumes)
./scripts/coas-attach     # docker exec into coas-agent and start pi
./scripts/coas-logs       # tail logs across all four services
./scripts/coas-backup     # snapshot persistent state (volumes + ~/.pi)
```

### When to use which

| Scenario                                                          | Use                                         |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Day-to-day interactive use on your dev box                        | `coas-stack` (Ctrl+C to stop)               |
| Running under systemd / launchd as a service                      | `coas-stack` as the `ExecStart`             |
| One-off "I just need it running" then back to other work          | `coas-up`                                   |
| Running the stack while you reboot / SSH disconnect               | `coas-up` (it persists on its own)          |
| Debugging a specific failing container                            | `coas-up` + `docker compose logs <service>` |
| Want auto-restart with sensible limits and visible health logging | `coas-stack`                                |

### How `coas-stack` differs from docker's restart policy

The compose file already has `restart: unless-stopped` on every service, so docker itself will restart any container that crashes. `coas-stack` adds three things on top:

1. **Visibility.** You see in real-time which service crashed and how many times it's been restarted.
2. **A restart limit.** Docker's `unless-stopped` will loop forever. `coas-stack` gives up after 3 restarts in 5 minutes and tells you the service needs manual attention — preventing a misconfigured service from burning CPU in a restart loop.
3. **Single foreground process.** `coas-stack` is a normal foreground shell process. Ctrl+C tears down the stack cleanly. Suitable as a systemd ExecStart with `Type=exec`.

## Talking to the chief of staff

Either:

- **At the host**: `./scripts/coas-attach` → pi TUI directly
- **From your phone**: type in the Element X room → arrives in the agent's inbox → reply via `matrix_send`

You'll generally use the phone path for quick check-ins ("what's on the kanban", "did the deploy finish") and the host path for substantive sessions.

## Adding more secrets later

```bash
echo 'value' | ~/git/tools-and-skills/scripts/coas-secrets.sh set <key>
```

Available keys: `matrix-token`, `matrix-recovery`, `tailscale-authkey`. Adding new ones requires extending `coas-secrets.sh` and `coas-up`.

## Rotating the bot's access token

Periodically (every few weeks, or after any suspected leak):

```bash
# 1. Invalidate the old token
TOKEN="$(~/git/tools-and-skills/scripts/coas-secrets.sh get matrix-token)"
curl -X POST https://coas-matrix.tail12345.ts.net/_matrix/client/v3/logout \
  -H "Authorization: Bearer ${TOKEN}"

# 2. Get a new token via the matrix-login script
npx tsx ~/git/tools-and-skills/scripts/matrix-login.ts \
  --homeserver https://coas-matrix.tail12345.ts.net \
  --user @coas-bot:coas-matrix.tail12345.ts.net
# Prompts for the bot's password, prints the new token

# 3. Update the secret store
echo 'syt_NEW_TOKEN_HERE' | \
  ~/git/tools-and-skills/scripts/coas-secrets.sh set matrix-token

# 4. Restart so the coas-agent picks up the new env var
cd ~/git/coas/infra
./scripts/coas-down
./scripts/coas-up
```

---

# Backups

```bash
./scripts/coas-backup
```

Snapshots:

| Source                            | Why                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `continuwuity-data` Docker volume | All Matrix room history, accounts, server state                              |
| `tailscale-state` Docker volume   | Tailscale node identity (lose this and you re-auth via authkey, no big deal) |
| `~/.pi` (bind mount)              | Pi state, agent registry, kanban, memories, **matrix crypto store**          |

Backups land in `~/coas-backups/coas-YYYYMMDD-HHMMSS.tar.gz`. The script keeps the last 7 and prunes older ones.

The script quiesces Continuwuity (via `docker compose stop`) before snapshotting its volume so RocksDB is in a consistent state, then restarts it.

**What's NOT backed up here**: the `coas/` and `tools-and-skills/` git repos. They're git repositories — push them to your remote.

### Schedule it

```bash
# macOS — launchd, ~/Library/LaunchAgents/com.jim.coas-backup.plist
# (write the plist to invoke /Users/jim/git/coas/infra/scripts/coas-backup nightly)

# Linux — cron
crontab -e
# Add:
0 3 * * * /home/jim/git/coas/infra/scripts/coas-backup >> /home/jim/coas-backups.log 2>&1
```

### Restore

```bash
./scripts/coas-down
docker volume rm infra_continuwuity-data infra_tailscale-state
docker volume create infra_continuwuity-data
docker volume create infra_tailscale-state

# Untar into the volumes via a helper container
docker run --rm \
  -v infra_continuwuity-data:/dest/continuwuity \
  -v infra_tailscale-state:/dest/tailscale \
  -v ~/coas-backups:/backups:ro \
  alpine:latest \
  sh -c "tar xzf /backups/coas-20260411-030000.tar.gz -C /dest && \
         mv /dest/continuwuity/* /dest/continuwuity/ && \
         mv /dest/tailscale/* /dest/tailscale/"

# Restore ~/.pi from a separate snapshot (or rsync from a different machine)
tar xzf ~/coas-backups/coas-20260411-030000.tar.gz -C / pi-state

./scripts/coas-up
```

---

# Updating

Rough monthly upgrade workflow:

```bash
cd ~/git/coas/infra

# Pull latest images for continuwuity, caddy, tailscale
docker compose pull

# Bump pi-coding-agent version (edit the PI_VERSION ARG in Dockerfile.coas-agent first if needed)
docker compose build coas-agent

# Restart with new images
./scripts/coas-down
./scripts/coas-up

# Verify
./scripts/coas-logs
docker compose ps
```

Watch the upstream release pages for security advisories:

- [Continuwuity releases](https://github.com/continuwuity/continuwuity/releases)
- [matrix-bot-sdk releases](https://github.com/turt2live/matrix-bot-sdk/releases)
- [Caddy releases](https://github.com/caddyserver/caddy/releases)
- [Tailscale releases](https://github.com/tailscale/tailscale/releases)

---

# Troubleshooting

### `coas-up: matrix-token is empty`
You haven't stored it yet. Run `echo 'syt_...' | ~/git/tools-and-skills/scripts/coas-secrets.sh set matrix-token`.

### `coas-up: TS_FQDN not set`
You haven't set `TS_FQDN` in `.env`. Open `.env` and add e.g. `TS_FQDN=coas-matrix.tail12345.ts.net`.

### Phone can't reach the homeserver
- Is the phone on Tailscale? Check the VPN toggle.
- Does the Tailscale admin console show the new node as online?
- Try `tailscale ping coas-matrix` from another tailnet device.
- Check the tailscale container logs: `docker compose logs tailscale`. Look for "Wireguard configured" or auth errors.
- Did you enable HTTPS Certificates in the Tailscale admin? Caddy can't fetch certs without it.

### Bot device shows as "unverified" forever
The crypto store is being wiped between restarts. Check that `~/.pi` is bind-mounted (`docker compose config | grep -A2 coas-agent | grep -A1 volumes`) and that `~/.pi/agent/matrix-crypto/` survives `coas-down && coas-up` on the host.

If you see new device IDs every restart, the crypto store path is wrong or the directory isn't writable. Check `cryptoStorePath` in `coas/.pi/settings.json`.

### Continuwuity fails to start with config errors
Continuwuity's config schema may have shifted between versions. Check `docker compose logs continuwuity` for the specific field name, and reconcile against the upstream config reference at [github.com/continuwuity/continuwuity](https://github.com/continuwuity/continuwuity).

### `docker compose exec coas-agent pi` shows "command not found"
The pi-coding-agent npm install in the Dockerfile failed at build time. Run `docker compose build coas-agent` and watch the build output for npm errors. The most common cause is matrix-bot-sdk's transitive native binding (`@matrix-org/matrix-sdk-crypto-nodejs`) failing to compile — check the build logs around the crypto package install.

### Matrix extension can't find matrix-bot-sdk at runtime
The bind mount overlays the host's `~/git/tools-and-skills/node_modules` into the container. If you forgot to `npm install` on the host before building, the dep is missing. Run:
```bash
cd ~/git/tools-and-skills
npm install
```

### Re-enabling registration on Continuwuity
If you closed registration but need to add another account:
1. Edit `infra/config/continuwuity.toml`, add `registration_token = "$(openssl rand -hex 16)"`
2. `docker compose restart continuwuity`
3. Note the token, register the new account
4. Remove the `registration_token` line and `restart` again

### "Unable to decrypt" appears on the phone for messages from the bot
The bot's device isn't verified. Re-do Step 14.

If the bot's device WAS verified but now isn't, the crypto store was wiped. Re-verify, and consider enabling Secure Backup to recover historical session keys.

### Logs show `TLS error` for Caddy
- Tailscale HTTPS Certificates not enabled in the admin console (Step 1)
- The `tailscale-sock` volume isn't shared between tailscale and caddy — `docker compose config | grep tailscale-sock` should show it mounted into both
- The cert provider hasn't fetched the cert yet — wait 30 seconds and retry

---

# File reference

```
infra/
├── README.md                  # this file
├── docker-compose.yml         # the four services
├── Dockerfile.coas-agent      # pi container image
├── .dockerignore              # exclude everything (Dockerfile uses no COPY)
├── .env.example               # template (no secrets)
├── .gitignore                 # excludes .env
├── config/
│   ├── continuwuity.toml      # Matrix homeserver config (edit server_name before first start)
│   └── Caddyfile              # TLS termination + .well-known + reverse proxy
└── scripts/
    ├── coas-stack             # SUPERVISED foreground mode — resolves secrets,
    │                          #   brings up the stack, watches health, restarts
    │                          #   failed services, gracefully tears down on signal
    ├── coas-up                # DETACHED mode — resolves secrets, brings up the
    │                          #   stack, returns immediately
    ├── coas-down              # stop the stack (volumes persist)
    ├── coas-attach            # docker exec into coas-agent and start pi
    ├── coas-logs              # tail logs across services
    └── coas-backup            # snapshot persistent state
```

---

# Migration to a different host

The stack is portable. To move from your Mac to the DGX (or vice versa):

1. **Install prerequisites on the new host** (Step 1, Step 2 of the walkthrough — Tailscale + secret store + Docker)
2. **Clone the two git repos** under `~/git/`
3. **Copy three secrets** to the new host's secret store:
   ```bash
   # On the old host:
   ~/git/tools-and-skills/scripts/coas-secrets.sh get matrix-token
   ~/git/tools-and-skills/scripts/coas-secrets.sh get tailscale-authkey
   ~/git/tools-and-skills/scripts/coas-secrets.sh get matrix-recovery   # if used
   
   # On the new host (paste each value):
   echo 'syt_...' | ~/git/tools-and-skills/scripts/coas-secrets.sh set matrix-token
   echo 'tskey-auth-...' | ~/git/tools-and-skills/scripts/coas-secrets.sh set tailscale-authkey
   echo '...' | ~/git/tools-and-skills/scripts/coas-secrets.sh set matrix-recovery
   ```
4. **Restore persistent state** from the latest `coas-backup` tarball (or start fresh and re-do device verification)
5. **Copy `infra/.env`** with the same `TS_FQDN`
6. `cd ~/git/coas/infra && ./scripts/coas-up`

The Tailscale node identity carries over via the volume snapshot (you don't need to re-auth). The Matrix bot's MXID is the same (the access token is unchanged). Your phone's Element X reaches the new host via the same `*.ts.net` hostname because that's a property of the Tailscale identity, not the underlying machine.

The bot will appear as the SAME device on the new host because the crypto store is in the bind-mounted `~/.pi/agent/matrix-crypto/` directory, which gets restored from your `coas-backup` snapshot. **No re-verification needed** when migrating with state intact.

---

# Architecture deep-dive (for the curious)

## Why Caddy and not just Tailscale Serve?

Tailscale Serve handles TLS termination and port mapping fine — it would have been enough for the basic "expose `:8008` as `:443` over the tailnet" job. But Matrix has two requirements that Tailscale Serve doesn't handle:

1. **`.well-known/matrix/client` discovery.** Element X and other Matrix clients fetch this static JSON file on first sign-in to find the homeserver's actual base URL. Continuwuity's built-in `.well-known` serving is brittle. Caddy serves these files as static responses without going through the homeserver at all.
2. **Blast isolation.** Caddy is a tiny memory-safe Go binary written by people obsessed with HTTP correctness. Putting it between the network and Continuwuity adds a battle-tested HTTP sanitisation layer at zero meaningful cost (~10 MB RAM, one extra container).

If you ever want to know "why did we add Caddy instead of just using Tailscale Serve", the answer is the discovery files and the buffer. The TLS story would have been fine without it.

## Why this netns layout (and not the inverse)

There are two ways to wire up "matrix homeserver behind tailscale" with the sidecar pattern:

**Option A (chosen):** `tailscale` is the netns owner; `caddy` joins it via `network_mode: service:tailscale`. Continuwuity and coas-agent stay on the docker bridge as normal members.

**Option B:** `continuwuity` is the netns owner; `tailscale` and `caddy` join it. Coas-agent must also join the same netns to reach continuwuity, addressing it via `127.0.0.1:8008` (loopback) instead of docker DNS.

We chose A because:

1. **Coas-agent stays on the docker bridge** with normal container DNS — no loopback gymnastics, no `127.0.0.1` magic in the matrix extension's config.
2. **Continuwuity has a stable docker DNS name** (`continuwuity:8008`) reachable from anywhere on `coas-net`.
3. **Only the public-facing TLS endpoint** (Caddy) needs the tailnet identity. Internal services don't.
4. The matrix extension's `homeserver` config stays portable — `http://continuwuity:8008` works inside this stack and any other Matrix homeserver URL works outside it. Same code, different config.

## Threat model

**What the stack protects against:**
- ✅ Anyone on the public internet reading your messages (Tailscale-only access + E2EE)
- ✅ matrix.org or any other Matrix operator reading your messages (you're not using them)
- ✅ A compromised reverse proxy reading message content (E2EE — Caddy only sees encrypted blobs)
- ✅ A compromised homeserver process reading message content (same — Continuwuity only stores encrypted blobs)

**What it does NOT protect against:**
- ❌ A compromised host reading message content via the bind-mounted `~/.pi/agent/matrix-crypto/` directory
- ❌ A compromised host reading the access token from the secret store
- ❌ Anyone with physical access to the host
- ❌ Tailscale itself being compromised at the control-plane level (they can see metadata, not content)
- ❌ Element X on a compromised phone

For all of these, the mitigation is host-level security (full-disk encryption, screen lock, secure boot, etc.) — not anything this stack can do.

## Why no federation

Federation is the Matrix feature that lets your homeserver talk to other homeservers (e.g. matrix.org users joining your room). For a personal channel between you and the chief of staff, federation:

- Adds a public attack surface (federation port 8448)
- Leaks metadata to other homeservers
- Adds complexity for zero benefit (you don't need to talk to anyone else)

So `allow_federation = false` in `continuwuity.toml`, no port 8448 exposed in `docker-compose.yml`, and Caddy returns `{}` for `/.well-known/matrix/server` defensively.

If you ever want to invite a friend on matrix.org, that's a config flip — but it's not in scope for this deployment.

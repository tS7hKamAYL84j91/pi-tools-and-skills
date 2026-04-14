# CoAS Stack — Self-hosted Matrix + Chief of Staff (Docker)

Private **Matrix homeserver** (Continuwuity) + **Chief of Staff agent** (pi) + **Caddy** reverse proxy + **Tailscale** mesh networking. Phone (Element X) reaches the agent through an encrypted Matrix room over Tailscale. No public internet exposure.

## Quick start

```bash
cd ~/git/pi-tools-and-skills/coas-infra

# One command — prompts for everything on first run:
./scripts/coas-up

# Or non-interactive:
./scripts/coas-up \
  --bot-password 'STRONG_PASSWORD' \
  --personal-user jim \
  --personal-password 'STRONG_PASSWORD'

# Or JSON (agent-friendly):
./scripts/coas-up --config '{"ts_authkey":"tskey-auth-...","ts_fqdn":"coas-matrix.TAILNET.ts.net","bot_password":"X","personal_user":"jim","personal_password":"Y"}'
```

`coas-up` handles everything:
1. Prompts for missing secrets (Tailscale auth key, TS_FQDN) and stores them
2. Generates `continuwuity.toml` from template
3. Starts all four containers
4. Configures Tailscale Serve (HTTPS:443 → HTTP:80)
5. Waits for HTTPS health check
6. Auto-bootstraps Matrix accounts + room on first run

After startup:
```bash
./scripts/coas-attach     # start pi inside the container
./scripts/coas-logs       # tail logs
./scripts/coas-down       # stop the stack
```

### Phone setup

1. Install **Tailscale** + **Element X** on your phone
2. Join your tailnet in the Tailscale app
3. In Element X: sign in to `https://coas-matrix.YOUR-TAILNET.ts.net` with the personal user/password from bootstrap
4. The "Chief of Staff" room is already there — send a message

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Host                                                         │
│                                                               │
│  coas-net (docker bridge) ──────────────────────────────┐     │
│                                                         │     │
│   ┌─────────────────────────┐                           │     │
│   │ tailscale (netns owner) │                           │     │
│   │ ┌─────────────────────┐ │   ┌─────────────────────┐ │     │
│   │ │ caddy               │ │   │ continuwuity        │ │     │
│   │ │ :443 → /_matrix/*   │─┼──▶│ :8008               │ │     │
│   │ └─────────────────────┘ │   └─────────────────────┘ │     │
│   └────────────┬────────────┘            ▲              │     │
│                │              ┌──────────┴─────────┐    │     │
│                │              │ coas-agent (pi)    │    │     │
│                │              │ matrix extension   │    │     │
│                │              └────────────────────┘    │     │
│  ──────────────┼────────────────────────────────────────┘     │
└────────────────┼──────────────────────────────────────────────┘
                 ▼
           Tailnet (private mesh) → Phone (Element X, E2EE)
```

| Service | Role |
|---------|------|
| **tailscale** | Netns owner. Joins the tailnet, provides mesh identity. |
| **caddy** | TLS termination, `.well-known` discovery, reverse proxy to Continuwuity. |
| **continuwuity** | Lightweight Rust Matrix homeserver (~100 MB RAM). |
| **coas-agent** | Pi + matrix extension. Bind-mounts `~/git/` and `~/.pi/`. |

### Bind mounts

| Host | Container | Purpose |
|------|-----------|---------|
| `~/git/` | `/workspace` | All git repos. Override: `GIT_ROOT` in `.env`. |
| `~/.pi/` | `/home/coas/.pi` | Agent state, kanban, crypto store. Override: `PI_STATE_DIR` in `.env`. |

### Network model

- **Internal**: containers reach Continuwuity at `http://continuwuity:8008` via Docker DNS
- **External**: phone reaches Caddy at `https://*.ts.net:443` via Tailscale mesh
- **No public internet exposure** — only tailnet members can connect
- **No federation** — `allow_federation = false`

---

## Prerequisites

| Tool | Install |
|------|---------|
| Docker + docker-compose | Docker Desktop (macOS) or `apt install docker.io docker-compose-plugin` (Linux) |
| Tailscale account | Free tier at [tailscale.com](https://tailscale.com) |
| Tailscale on phone | App Store / Play Store |
| Element X on phone | App Store / Play Store |
| Secret store (Linux only) | `apt install pass gnupg2` then `gpg --gen-key` |

Enable **HTTPS Certificates** in the [Tailscale admin → DNS](https://login.tailscale.com/admin/dns) settings.

```bash
# Clone repos
mkdir -p ~/git && cd ~/git
git clone <YOUR_REMOTE>/coas.git
git clone <YOUR_REMOTE>/pi-tools-and-skills.git
cd pi-tools-and-skills && npm install
```

---

## Commands

```bash
./scripts/coas-up         # start stack (+ bootstrap on first run)
./scripts/coas-down       # stop stack (state persists in volumes)
./scripts/coas-attach     # start pi inside coas-agent
./scripts/coas-logs       # tail logs across all services
```

---

## Secrets

Stored in the platform secret store (macOS Keychain / Linux `pass`). `coas-up` prompts for missing secrets on first run.

| Key | Purpose | When set |
|-----|---------|----------|
| `tailscale-authkey` | Tailscale container auth | First `coas-up` |
| `matrix-token` | Bot's Matrix access token | Auto (bootstrap) |
| `bot-password` | Bot's password for cross-signing UIA | Auto (bootstrap) |
| `matrix-recovery` | Optional Secure Backup passphrase | Manual if needed |

Manage secrets manually:
```bash
echo 'value' | ./scripts/coas-secrets set <key>
./scripts/coas-secrets get <key>
./scripts/coas-secrets list
```

---

## E2EE and cross-signing

The matrix extension automatically:
1. Generates Ed25519 cross-signing keys on first start
2. Uploads them to the homeserver via UIA (using the stored bot password)
3. Signs the bot's device with the self-signing key

Element X sees the bot as a verified device and shares Megolm session keys. No manual device verification needed.

---

## Troubleshooting

### Phone can't reach the homeserver
- Is the phone on the same tailnet? Check the Tailscale app.
- Is HTTPS Certificates enabled in Tailscale admin → DNS?
- Try `curl https://coas-matrix.YOUR-TAILNET.ts.net/_matrix/client/versions` from the host.

### Bot can't decrypt messages
- Wipe the crypto store and restart: `rm -rf ~/.pi/agent/matrix-crypto`
- Check that `bot-password` is in the secret store: `./scripts/coas-secrets get bot-password`

### Continuwuity won't start
- Check logs: `docker logs coas-infra-continuwuity-1`
- If `server_name` was changed after first boot, wipe the volume: `docker volume rm infra_continuwuity-data`

### Token rotation
```bash
make rotate-token     # logs in with stored password, updates secret store
```

---

## Design decisions

**Why Caddy?** Matrix clients need `/.well-known/matrix/client` for homeserver discovery. Caddy serves this as static JSON and adds HTTP sanitisation between the network and Continuwuity.

**Why this netns layout?** Tailscale owns the netns; Caddy joins it. Continuwuity and coas-agent stay on the Docker bridge with normal DNS. This keeps the matrix extension's `homeserver` config portable (`http://continuwuity:8008`).

**Why no federation?** Personal channel between you and the agent. Federation adds attack surface and metadata leakage for zero benefit.

## Threat model

**Protected against:** public internet access, third-party Matrix operators, compromised reverse proxy or homeserver reading content (E2EE).

**Not protected against:** compromised host (can read crypto store / tokens), compromised phone, Tailscale control-plane compromise. Mitigations: host-level security (FDE, screen lock, secure boot).

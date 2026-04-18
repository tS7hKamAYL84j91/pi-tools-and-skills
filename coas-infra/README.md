# CoAS Stack — Self-hosted Matrix + Chief of Staff (Docker)

Private Matrix homeserver (Continuwuity) + Chief of Staff agent (pi) + Caddy reverse proxy + Tailscale mesh. Phone (Element X) reaches the agent through an encrypted Matrix room. No public internet exposure.

For getting started and commands, see the [main README](../README.md).

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

## Secrets

Stored in the platform secret store (macOS Keychain / Linux `pass`). `make up` prompts for missing secrets on first run.

On Linux, make sure both `pass` and `gpg` are installed and that `pass` has been initialized before first use:

```bash
gpg --full-generate-key
pass init <your-gpg-key-id>
```

| Key | Purpose | When set |
|-----|---------|----------|
| `tailscale-authkey` | Tailscale container auth | First `make up` |
| `matrix-token` | Bot's Matrix access token | Auto (bootstrap) |
| `bot-password` | Bot's password for cross-signing UIA | Auto (bootstrap) |
| `matrix-recovery` | Optional Secure Backup passphrase | Manual if needed |

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
- Wipe the crypto store and restart: `make clean`
- Check that `bot-password` is in the secret store: `scripts/coas-secrets get bot-password`

### Continuwuity won't start
- Check logs: `docker logs coas-infra-continuwuity-1`
- If `server_name` was changed after first boot, wipe the volume: `docker volume rm infra_continuwuity-data`

---

## Design decisions

**Why Caddy?** Matrix clients need `/.well-known/matrix/client` for homeserver discovery. Caddy serves this as static JSON and adds HTTP sanitisation between the network and Continuwuity.

**Why this netns layout?** Tailscale owns the netns; Caddy joins it. Continuwuity and coas-agent stay on the Docker bridge with normal DNS. This keeps the matrix extension's `homeserver` config portable (`http://continuwuity:8008`).

**Why no federation?** Personal channel between you and the agent. Federation adds attack surface and metadata leakage for zero benefit.

## Threat model

**Protected against:** public internet access, third-party Matrix operators, compromised reverse proxy or homeserver reading content (E2EE).

**Not protected against:** compromised host (can read crypto store / tokens), compromised phone, Tailscale control-plane compromise. Mitigations: host-level security (FDE, screen lock, secure boot).

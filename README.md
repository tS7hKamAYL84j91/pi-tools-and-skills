# pi-tools-and-skills

Pi agent infrastructure: multi-agent orchestration, kanban task tracking, phone-to-agent Matrix bridge, machine memories, and reusable skills.

## Quick start

```bash
git clone https://github.com/tS7hKamAYL84j91/pi-tools-and-skills.git
cd pi-tools-and-skills
npm install
./setup-pi.sh        # registers extensions, skills, memories, secrets, shell hooks
exec zsh             # reload shell
coas                 # start pi in the coas workspace (alias set by setup-pi.sh)
```

## Extensions

### Global (loaded in every pi session)

| Extension          | What it does                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **pi-panopticon**  | Multi-agent messaging (`agent_send`), spawning (`spawn_agent`), health monitoring (`agent_status`), and lifecycle management |
| **machine-memory** | `.mmem.yml` cheat sheets — gradual-exposure tool/domain knowledge injected into agent context on demand                      |

### Project (add per-workspace in `.pi/settings.json`)

| Extension  | What it does                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| **kanban** | Event-sourced task board — 14 tools, TUI overlay (`/kanban`), auto-compaction, file watcher, snapshot renderer     |
| **matrix** | Phone ↔ agent bridge via a private Matrix room — notification + inbox pattern, `message_read` / `message_send` tools |

## Deployment

The `coas-infra/` directory contains a Docker Compose stack for self-hosted deployment:

- **Continuwuity** — lightweight Rust Matrix homeserver
- **Caddy** — reverse proxy with `.well-known` discovery
- **Tailscale** — private mesh networking (no public IP needed)
- **coas-agent** — pi running in a container with bind-mounted repos

```bash
make up BOT_PASSWORD=X PERSONAL_USER=jim PERSONAL_PASSWORD=Y
# Or: cd coas-infra && ./scripts/coas-up --bot-password X --personal-user jim --personal-password Y
```

See [coas-infra/README.md](coas-infra/README.md) for the full setup walkthrough.

## Structure

```
extensions/
  pi-panopticon/        Agent messaging, spawning, health, registry, TUI
  machine-memory/       .mmem.yml discovery, injection, validation

project-extensions/
  kanban/               Event-sourced board, compaction, overlay, watcher
  matrix/               Matrix bridge, sync loop, notification + inbox

coas-infra/             Docker deployment (Continuwuity + Caddy + Tailscale)
lib/                    Shared: agent-api, maildir transport, tool-result helpers
skills/                 Agent skills (clean-room, deep-research, planning, ...)
memories/               Global .mmem.yml files (pi-kanban, pi-extension-dev, ...)
scripts/                coas-secrets, matrix-login, clean-mailboxes
prompts/                refactor, commit-and-push
tests/                  Tests (vitest + archunit fitness functions)
```

## Development

```bash
make check        # typecheck → biome lint → knip → type-coverage (≥95%)
make test         # 232 tests
make setup        # configure pi extensions, skills, shell hooks (first time)
```

Quality gates: strict TypeScript, Biome lint, zero unused exports (knip), 95%+ type coverage, architecture fitness functions (dependency direction, file size limits, isolation). See [AGENT.md](AGENT.md) for coding standards.

## Security TODO

Findings from a red-team audit (T-251/T-252/T-253). The current design assumes a **trusted host** and **trusted self-hosted Matrix homeserver** behind a private Tailscale mesh — these are defense-in-depth hardening items, not active exploits. PRs welcome.

### Critical

- [ ] **Sanitise Matrix message bodies** — message text is injected raw into agent context; wrap in `<external-matrix-messages>` tags and strip from poke notifications (CVSS 9.9)
- [ ] **Add Matrix sender allowlist** — any room member can inject instructions; add `trustedSenderMxid` config field and validate every inbound message (CVSS 9.9)
- [ ] **Fix newline injection in kanban log** — `escapeLogValue()` doesn't strip newlines; forged log events can fake task completions (CVSS 9.1)
- [ ] **Sanitise agent message content** — unescaped `agent_send` payloads go straight into LLM context; escape or deliver in a structured slot (CVSS 9.0)

### High

- [ ] **Validate `agentId` format** — unsanitised `agentId` in path construction enables maildir path traversal (CVSS 8.2)
- [ ] **Sign agent registry records** — unsigned registry files allow spoofing any agent identity (CVSS 8.8)
- [ ] **Sanitise agent name in kanban** — `agent` parameter logged without escaping; newline injection forges events (CVSS 8.8)
- [ ] **Escape mmem update content** — unescaped text in `.mmem.yml` appends can inject SYSTEM directives (CVSS 8.4)
- [ ] **Strip terminal escapes in TUI** — task titles can inject OSC/DCS sequences to hijack terminal state (CVSS 7.2)
- [ ] **Validate tool names** — comma in tool name injects additional tools past the restriction list (CVSS 7.6)

# pi-tools-and-skills

![Illustrative layering: a Pi host, Agent Hub, extensions, and prompt surfaces](docs/images/project-context-hub-prompt.jpeg)

Extensions, skills, prompts, and shared libraries for [Pi](https://github.com/earendil-works/pi).
The sketch is illustrative: Zellij, its plugin, and its config are not in this repo.

## Install

Needs Node.js 22.19+ and Pi 1.0.1. Local development also needs Python 3.10+ for
the offline Goal benchmark tests; secret scanning needs gitleaks, and Semgrep for
`make semgrep-scan`.

```sh
git clone https://github.com/tS7hKamAYL84j91/pi-tools-and-skills.git
cd pi-tools-and-skills
npm ci
```

Install the whole checkout:

```sh
pi install /absolute/path/to/pi-tools-and-skills
pi install git:github.com/tS7hKamAYL84j91/pi-tools-and-skills
```

Or one extension: `make setup-package PACKAGE=<name>`.

`make setup` registers this checkout globally with Agent Hub and Goal enabled.
`make setup PROJECT=<dir>` writes that registration to the project's
`.pi/settings.json` instead; Pi reads it only after project trust is granted.
`make setup-clean` removes either. Project-only extensions are enabled per
workspace. Setup changes package registration only.

`make help` lists every target.

## Packages

Each package README owns its commands, settings, install scope, and limits. This
index does not repeat them.

| Package                                                  | Responsibility                                 |
| -------------------------------------------------------- | ---------------------------------------------- |
| [Agent Hub](extensions/pi-agent-hub/README.md)           | Agent registry, transport, spawning and health |
| [Goal](extensions/pi-goal/README.md)                     | Owned goal execution and local completion hook |
| [Team Workflows](extensions/pi-team-workflows/README.md) | Bounded consult, debate and research           |
| [Boost](extensions/pi-boost/README.md)                   | Prompt-scoped model switching and restoration  |
| [Automations](extensions/pi-automations/README.md)       | Pi-hosted scheduling and workspace context     |
| [Kanban](extensions/pi-kanban/README.md)                 | Optional human task overview                   |
| [Matrix](extensions/pi-matrix/README.md)                 | Human-facing Matrix transport                  |
| [File Watch](extensions/pi-file-watch/README.md)         | Explicit, bounded file notifications           |
| [Overview](extensions/pi-overview/README.md)             | Read-only project overview (`/overview`)       |
| [Ollama Models](extensions/pi-ollama-models/README.md)   | Local Ollama model discovery                   |
| [Fleet MCP](fleet-mcp/README.md)                         | Standalone MCP adapter                         |

## Layout

A Pi package repo, not an npm workspace: `extensions/*` load by path and install
individually, with no root `workspaces` field and no cross-package build graph.
The root `package.json` `files` allowlist decides what the umbrella ships.

- `extensions/` — Pi features and their usage docs.
- [`lib/`](lib/README.md) — shared contracts and infrastructure.
- `fleet-mcp/` — standalone application, not another registry.
- `skills/`, `prompts/` — reusable agent guidance; extension-specific skills stay
  with their extension.
- `scripts/` — install, maintenance, and build/check commands.
- [`benchmarks/`](benchmarks/README.md) — evaluation runners, not shipping runtime.
- `tests/` — offline checks, including benchmark fixture and fake-provider coverage.
- [`docs/`](docs/README.md) — architecture boundaries and decision history.
- [`TODO.md`](TODO.md) — current work only; finished work lives in Git history.

## Development and security

```sh
make check        # namespace, template safety, types, lint, knip, type coverage
make test         # offline unit, contract, architecture and evaluation tests
make build        # standalone Fleet MCP adapter (dist/fleet-mcp)
make secret-scan  # history and working-tree secret checks
make semgrep-scan # custom Semgrep OSS rules (needs semgrep, or set SEMGREP_BIN)
make audit        # production dependency advisories
make ci           # the whole CI gate in one run
```

Run focused tests while editing, full checks before finishing. Architecture tests
guard dependencies, state ownership, and safety contracts, not file size. See
[AGENTS.md](AGENTS.md) for contribution rules and
[architecture](docs/architecture.md) for state and trust ownership.

The design assumes a trusted host. Messages, repository text, and model output are
untrusted input, never permission to skip a safety gate. Credentials and live
deployment config stay out of this repo.

[MIT license](LICENSE)

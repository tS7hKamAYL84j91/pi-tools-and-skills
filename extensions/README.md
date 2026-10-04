# Extensions

One directory per Pi feature. Each package owns its `README.md`, `package.json`,
and `index.ts`, and can be installed on its own.

```bash
pi install /absolute/path/to/extensions/<package>
# or from this repository:
make setup-package PACKAGE=<package>
```

| Package | Responsibility |
| --- | --- |
| [`pi-agent-hub`](pi-agent-hub/README.md) | Agent registry, transport, spawning and health |
| [`pi-automations`](pi-automations/README.md) | Pi-hosted scheduling and workspace context |
| [`pi-boost`](pi-boost/README.md) | Prompt-scoped model switching and restoration |
| [`pi-file-watch`](pi-file-watch/README.md) | Explicit, bounded file notifications |
| [`pi-goal`](pi-goal/README.md) | Owned goal execution and local completion hook |
| [`pi-kanban`](pi-kanban/README.md) | Optional human task overview |
| [`pi-matrix`](pi-matrix/README.md) | Human-facing Matrix transport |
| [`pi-ollama-models`](pi-ollama-models/README.md) | Local Ollama model discovery |
| [`pi-team-workflows`](pi-team-workflows/README.md) | Bounded consult, debate and research |

Shared code lives in [`../lib`](../lib/README.md). Extensions must not import
another extension's internals; use documented tools, commands or session events.

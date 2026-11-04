# Scripts

Repository automation and standalone CLI helpers. None is loaded by Pi at runtime.

## Checks

- `check-namespace.mjs`, `check-template-safety.mjs` — `npm run check` guards. `check-package-imports.mjs` runs in the CI install/import smoke test and the Goal completion hook.
- `semgrep-scan.mjs` — `npm run security:semgrep`, using [`../rules/`](../rules/README.md).
- `builtins.json` — reserved Pi command names used by the namespace check.

## Agent Hub side pane

```sh
./scripts/pi-agents-pane --scope <canonical-lead> [--registry <dir>] [--interval <seconds>] [--once] [--json] [--no-color]
```

Standalone Node ESM terminal view for one Zellij tab's lead agent and its namespace helpers. Reads `~/.pi/agents` every 2 seconds by default (`--interval 0.25..3600`) without mutating registry files or consuming inboxes. `--json` implies `--once`; unreadable registry exits `3`, usage errors exit `2`.

### Keys & actions (Zellij interactive mode)

Footer: `n:new c:close l:lead q:quit` (`n+ c- l:lead q:quit` below 27 columns; read-only fallback: `q:quit`).

- `j` / `k` or arrows — select an agent row.
- `Enter` or left click — focus the selected agent's pane in the same Zellij tab/session. Hidden floating panes are revealed and raised; focusing a tiled pane hides the floating layer while agents keep running. Requires a fresh heartbeat (≤30s), live PID evidence, and `AgentRecord.zellij` metadata.
- `n` — create a named interactive `pi --name <name>` in a floating pane in the same tab, project cwd, and Hub namespace using Pi's default model (`Enter` to preview, then `Enter`/`y` to confirm or `n`/`Esc` to cancel). Matrix credentials are stripped (`PI_MATRIX_DISABLED=1`).
- `c` — arm hard Zellij pane close for the selected same-tab pane (`Enter`/`y` within 5 seconds confirms; `n` cancels).
- `l` — designate the selected row as the panel-local lead until exit.
- `q` / `Ctrl-C` — quit the side pane and restore terminal state.

### Testing

Fixture snapshot (no live registry access):

```sh
./scripts/pi-agents-pane --scope demo --registry "$PWD/tests/fixtures/agent-hub-pane" --once --json
```

Opt-in detached Zellij 0.44.1 acceptance (creates and cleans up its own scratch session):

```sh
node scripts/test-agent-pane-zellij.mjs
```

## Setup

- `setup-pi`, `setup-pi-clean` — register or remove this checkout globally, or for one project with `--project <dir>` (see `make help`).
- `pi-package-settings.py` — package-settings helper used by the above.

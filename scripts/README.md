# Scripts

Repository automation and developer CLI helpers. None is loaded by Pi at runtime.

## Checks

- `check-namespace.mjs`, `check-template-safety.mjs` — `npm run check` guards. `check-package-imports.mjs` runs in the CI install/import smoke test and the Goal completion hook.
- `semgrep-scan.mjs` — `npm run security:semgrep`, using [`../rules/`](../rules/README.md).
- `builtins.json` — reserved Pi command names used by the namespace check.

## Setup

- `setup-pi`, `setup-pi-clean` — register or remove this checkout globally, or for one project with `--project <dir>` (see `make help`).
- `pi-package-settings.py` — package-settings helper used by the above.

## Compatibility forwarders

- `pi-agents-pane` — executable forwarder to [`../agent-hub-pane/pi-agents-pane`](../agent-hub-pane/README.md).

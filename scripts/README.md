# Scripts

Repository automation. None is loaded by Pi at runtime.

## Checks

- `check-namespace.mjs`, `check-template-safety.mjs` — `npm run check` guards. `check-package-imports.mjs` runs in the CI install/import smoke test and the Goal completion hook, not in `npm run check`.
- `semgrep-scan.mjs` — `npm run security:semgrep`, using [`../rules/`](../rules/README.md).
- `builtins.json` — reserved Pi command names used by the namespace check.

## Setup

- `setup-pi`, `setup-pi-clean` — register or remove this checkout (see `make help`).
- `pi-package-settings.py` — package-settings helper used by the above.

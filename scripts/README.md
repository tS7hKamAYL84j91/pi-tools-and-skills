# Scripts

Repository automation. None is loaded by Pi at runtime.

## Checks and builds

- `check-namespace.mjs`, `check-template-safety.mjs`, `check-package-imports.mjs` — `npm run check` guards.
- `semgrep-scan.mjs` — `npm run security:semgrep`, using [`../rules/`](../rules/README.md).
- `builtins.json` — reserved Pi command names used by the namespace check.

## Setup

- `setup-pi`, `setup-pi-clean` — register or remove this checkout (see `make help`).
- `pi-package-settings.py` — package-settings helper used by the above.

## Session CLIs

Operator utilities, run with the bundled loader (Pi ships `jiti`):

```sh
npx jiti scripts/session-source-cli.ts --limit 10
```

They are imported by `tests/session/` and are not part of the shipped package.

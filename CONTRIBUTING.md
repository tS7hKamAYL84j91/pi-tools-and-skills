# Contributing

Read [`AGENTS.md`](AGENTS.md) first: it defines scope, safety boundaries and the
"smallest useful change" rule. This file is only the mechanical checklist.

## Before you start

- Inspect `git status`; never overwrite uncommitted work.
- Read the module and its tests before editing.

## Checks

```sh
npm run check     # namespace, template safety, types, lint, knip, type coverage
npm test          # offline tests
git diff --check
```

Use focused tests while editing; run the full set before finishing. Changes with
live configuration, model defaults, residency or schedule cadence need explicit
approval.

## Layout

See [`README.md`](README.md) for where things belong, [`docs/`](docs/README.md)
for architecture and decisions, and [`tests/README.md`](tests/README.md) for the
test layout.

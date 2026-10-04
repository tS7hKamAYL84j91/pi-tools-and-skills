# ADR-064: Rename pi-panopticon to pi-agent-hub and pi-teams to pi-team-workflows

## Status

Accepted — 2026-10-04.

## Context

The package names did not describe their scope. `pi-panopticon` suggested
surveillance rather than agent coordination, and `pi-teams` did not distinguish
workflow execution from agent management.

## Decision

Rename the extension directories and packages:

- `pi-panopticon` → `pi-agent-hub`
- `pi-teams` → `pi-team-workflows`

Directory and package names change only. The following stay unchanged for
compatibility:

- tool and command names, including `/panopticon-reconcile` and `/teams`;
- configuration keys, storage paths and environment variables;
- persisted session event and generated-file identifiers (`pi-teams:*`,
  `generatedBy`).

## Consequences

- Source imports, CI, setup helpers and current documentation use the new names.
- Existing local installs that point at the old directories need an explicit
  settings-path update. No directory alias or live migration is added.
- Historical ADRs and reports keep their original names as records of the
  decisions made at the time.

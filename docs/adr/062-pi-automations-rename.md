# ADR-062: Rename pi-coas Extension to pi-automations

## Status

Accepted — 2026-09-15.

## Context

The scheduling/workspace/governance extension shipped as `pi-coas` (a "Coding
Agent System" brand), but its delivered surface is automation tooling:
schedules, workspaces, approvals, and governance routing. The old name also
collided with the panopticon registry agent named "coas" (a personified
identity), which made cross-references ambiguous. Cross-agent file collisions
on shared paths (T-923) showed that naming clarity matters operationally.
Jim directed a top-to-bottom rename with no backward compatibility.

## Decision

- Rename the extension and every user-facing identifier in one cutover:
  - `extensions/pi-coas` → `extensions/pi-automations`; `lib/coas-*` → `lib/automations-*`; `tests/coas` → `tests/automations`.
  - Tools `coas_*` → `automations_*`; commands `/coas` → `/automations(-status|-doctor|-workspaces|-schedules)`; `/pi-scheduler` keeps its name.
  - Env `COAS_*` → `AUTOMATIONS_*` (`HOME`, `TOOLS_MODEL`, `PI_LOCKFILE_CONTINUE`, `SCHEDULE_LOCK_STALE_SECONDS`, `WORKSPACE_ID`).
  - Settings keys `coasProfile` → `automationsProfile`; the `coas` home settings block is removed.
- Default home is `<cwd>/.pi/automations` (project-local). The `AGENT_HOME`/`~/.pi/coas` fallback is removed; env and settings overrides still work.
- Explicit-cwd targeting (workspace tools, scheduler delivery) requires an existing runtime under the target cwd; only the unqualified path bootstraps the default.
- File-backed schedule/workspace `.env` schemas keep their key names (`ROOM_ID`, `WORKSPACE_ID`, `CRON_EXPR`, …); only paths and process-env names change.
- Panopticon's agent named "coas" is a personified identity and is NOT renamed.
- Historical documents (ADRs, plans, reports) are renamed in place for consistency rather than kept as archival exceptions.

## Consequences

- Hard cutover: unmigrated runtimes fail on restart. Executive Office
  state-dir/settings/env migration is owned by Gravitas/Q with fail-closed
  reporting; agents keep old tool names until their pi restart.
- The `AGENTS.md` `coas-common-agents` fence markers stay as an integration
  contract with the coas-repo setup tooling until that tooling migrates.
- Cross-references from older external tooling to `pi-coas` paths will not
  resolve; consumers must follow this ADR's mapping.
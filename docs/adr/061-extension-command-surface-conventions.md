# ADR-061: Extension Command Surface and UX Conventions

## Status

Accepted — 2026-09-10.

## Context

Nine extensions evolved independently within the repository (`pi-boost`, `pi-coas`, `pi-file-watch`, `pi-goal`, `pi-kanban`, `pi-matrix`, `pi-ollama-models`, `pi-panopticon`, `pi-teams`), resulting in divergent user-facing patterns:

1. **Command topology divergence**: some extensions used root commands with subcommands (`/teams`, `/boost`, `/goal`), while others registered multiple top-level hyphenated commands (`/coas-status`, `/coas-doctor`, `/coas-workspaces`, `/coas-schedules`, `/pi-scheduler`, `/agent-external-*`) or duplicated logic across sibling commands (`/goal-clear` duplicating `/goal clear`).
2. **Duplicated toggle controls**: `/kanban-watch on|off` and `/panopticon-reconcile on|off` independently re-implemented the exact same handler flow, validation, and notification logic.
3. **Settings persistence fragmentation**: extensions hand-rolled disparate file reads, JSON parsing, advisory locks, and atomic file writes for `~/.pi/agent/settings.json` blocks instead of sharing a common safe abstraction.

## Decision

### 1. One Primary Command Stem Per Concern

Each extension exposes one primary command stem named after its domain (`/boost`, `/goal`, `/teams`, `/kanban`, `/agents`, `/coas`, `/file-watch`, `/matrix`).

- Subcommands handle specific actions (e.g. `/goal clear`, `/agents external [list|register|remove]`, `/coas [status|doctor|workspaces|schedules|scheduler]`).
- Pre-existing command names (such as `/goal-clear`, `/agent-external-*`, `/coas-*`) are retained as non-breaking aliases to preserve operator muscle memory and script compatibility.
- Bare root command invocation defaults to the primary interactive action (opening an overlay when present) or concise usage guidance.

### 2. Standardized Boolean Toggle Registration

Extensions with follow-up or notification toggles use the shared `registerToggleCommand(pi, options, control)` helper (`lib/toggle-command.ts`).
The command uniformly accepts `on` | `off`, and bare or unrecognized input reports current status with standard usage.

### 3. Shared Namespace Settings Block Persistence

Extensions reading or persisting configuration blocks in `settings.json` must use `lib/pi-settings.ts`:
- `readPiSettingsKey(key, path)` for scoped configuration reads.
- `savePiSettingsBlock(namespace, mutator, path)` for atomic, advisory-locked read-modify-write block operations with safe mode `0o600`.

### 4. Status Channel and Notification Voice

- Status powerline channels match the extension stem.
- Notifications use concise, feature-attributed messages (`<Feature> <action>: <details>`) for state mutations, `info` for confirmations, `warning` for actionable usage/denials, and `error` for operational failures.

## Consequences

- Slash-command autocomplete is clean and structured.
- Backward compatibility is strictly preserved via aliases.
- Duplicate settings I/O and toggle handling code is eliminated.

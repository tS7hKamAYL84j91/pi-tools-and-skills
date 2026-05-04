# ADR 3: Lifecycle Context Instruction Gate Simplification

## Status

Accepted

## Context

The `contextInstruction()` function in `lifecycle.ts` checked three conditions
before returning a CoAS context instruction:
1. `currentWorkspaceLabel(cwd)` — detect cwd-relative or env-based workspaces
2. `pathInside(workspaceRoot(config), cwd)` — detect cwd inside COAS_HOME
3. `existsSync(join(cwd, ".coas", "workspace.env"))` — detect external workspaces

Condition 3 was redundant because:
- If the cwd has `.coas/workspace.env`, it's an external workspace that
  `currentWorkspaceLabel` detects via `basename(cwd)`
- `pathInside` handles workspaces under COAS_HOME
- The `existsSync` call also imported `join` from `node:path` unnecessarily

## Decision

Removed the `.coas/workspace.env` file check and the unused `join` import.
Added a comment explaining why the remaining two conditions are sufficient.

## Consequences

- Simpler gate logic with no behavioral change.
- One fewer filesystem call per `before_agent_start` event.
- No import from `node:path` in `lifecycle.ts`.
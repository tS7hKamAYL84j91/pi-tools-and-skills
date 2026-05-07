# Teams Graph Affordances (Superseded)

**Status:** Superseded on 2026-05-04 by `docs/teams-simplification.md`.

The generic DAG executor plan is no longer the active direction for `extensions/pi-teams`. The accepted simplification is to keep `TeamHandler` as the protocol boundary and implement each supported topology directly behind `run()`.

Superseded items:

- GA-001 conditional edges
- GA-002 state channels
- GA-003 interrupts
- GA-004 nested subteams
- Stage 2/3 graph-manifest expansion

Standing replacement decision:

> Keep direct topology functions per protocol; do not reintroduce a generic DAG executor unless a concrete user-visible workflow cannot be implemented as a small direct handler.

Historical details before supersession are intentionally not preserved in this active document; use git history if the old graph-expansion plan is needed for archaeology.

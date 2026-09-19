# EO Fleet Overview

TypeScript rewrite of the EO Fleet Overview dashboard, colocated with the
shared pi libraries. It uses `lib/file-persistence.ts` for atomic directive
delivery and `lib/agent-registry.ts` for live-agent discovery.

## Run

```sh
npm run build:fleet-overview
PORT=8901 npm run start:fleet-overview
```

The app serves `static/index.html` and supports the `/fleet` mount prefix.

## Directives (comms box)

`directives/inbox/` receives Jim's notes (delivery only — nothing
auto-executes); Gravitas replies are read from `directives/replies/`.

## Control (gated stand-up / stand-down)

Per-agent dry-run preview → Jim confirms → the service runs the same
`make eo-agent-add` / `make eo-agent-remove` commands Q uses (APPLY=1) →
append-only audit into `control/audit.jsonl`. Single-use preview token
(10-min TTL) bound to action+agent; no free-form input reaches a command
line. Q/Gravitas: file-watch `control/audit.jsonl` for control events.

Deployment topology remains Q-owned.

## Data surfaces (parity with the Python host)

All tabs now serve real data, read-only: fleet (agent-registry liveness),
usage (incremental session-log ETL with a size/mtime-keyed cache),
events (campaign ledger tails + kanban board activity), brief (auto-digest
+ Gravitas's `awaiting.json`), board (board.log replayed into a projection),
schedules. Runtime dirs resolve to the source tree (or
`FLEET_OVERVIEW_HOME`), so a rebuild never loses inbox, audit, or cache.
`FLEET_AWAITING_PATH` relocates awaiting.json at the deployment switch.

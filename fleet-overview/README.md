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

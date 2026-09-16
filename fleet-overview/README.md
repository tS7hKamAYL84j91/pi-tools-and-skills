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
`directives/inbox/` receives Jim's notes (delivery only); Gravitas replies are
read from `directives/replies/`. Deployment topology remains Q-owned.

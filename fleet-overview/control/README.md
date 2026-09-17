# Control (gated stand-up / stand-down)

Runtime data for the v1 gated-control feature (TS host).

- `audit.jsonl` — append-only control log: one JSON line per confirmed
  execution (`ts, requestId, action, key, manifest, command, exitCode,
  output, requester`). **Gravitas/Q: file-watch this for control events**
  (the live Python host writes its own `eo-fleet-overview/control/audit.jsonl`
  until Q switches the deployment topology to this host).
- The service runs the same `make eo-agent-add` / `make eo-agent-remove`
  commands Q uses (cwd: `~/git/coas`): preview with `DRY_RUN=1`; execute
  only after Jim confirms in the UI, with `APPLY=1`.
- Execute requires a single-use preview token (10-minute TTL) bound to the
  same action + agent. No free-form input reaches the command line.
- Non-destructive by construction: the manager commands preserve repos and
  session history; live mutation without the dry-run gate is refused by the
  commands themselves.
- `audit.jsonl` is runtime data; not committed to git.
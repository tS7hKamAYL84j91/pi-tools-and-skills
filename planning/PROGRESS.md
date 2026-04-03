# Progress Log

## 2026-04-03 15:30 — Analysis complete

Investigated the full stack:
- `agent_peek` in panopticon reads a custom activity maildir at `~/.pi/agents/{id}/`
- This duplicates data that pi already writes to session JSONL at `~/.pi/agent/sessions/`
- The session JSONL has richer data (full messages, usage, timestamps)
- `AgentRecord` doesn't currently store session info, but `ExtensionContext.sessionManager` exposes it
- Subagents spawned with `--no-session` have no JSONL — need to fix that

Plan written to PLAN.md with 5 phases.

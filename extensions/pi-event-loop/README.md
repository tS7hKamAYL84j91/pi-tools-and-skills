# pi-event-loop

Session-local Event Modeling automation runtime for one Pi agent.

Implements the automation pattern `events → view → automated trigger → command → events`: immutable
facts are appended to a session event log, projected into todo views, and an automator issues
self-describing commands that are delivered to the current agent as new turns.

- **Specification:** [`SPEC.md`](./SPEC.md) — the authoritative implementation brief.
- **Backlog:** [`TODO.md`](./TODO.md).
- **Configuration:** `.pi/event-loop.json` in the project directory; strictly validated on session
  start. Without a configuration file the extension stays inert.
- **Isolation:** no dependency on other extensions, no cross-session communication, no multi-agent
  orchestration.

Design distinctions (SPEC §1): an event is an immutable fact; a view is derived information; a todo
item is projected work; a command is an intention to act; the agent handles commands and reports
outcomes as new facts; the automator contains no domain reasoning.
## What this does NOT do

- Discovers, starts, selects or routes to other agents; no cross-session or multi-agent
  communication of any kind (SPEC §2).
- Depends on Panopticon, CoAS, File Watch, OODA or any other extension; it runs with all
  other extensions disabled.
- Interprets whether a domain result is good — the automator contains no domain reasoning.
- Executes domain tools on the agent's behalf; the agent handles commands itself.
- Provides a distributed or project-wide event store; the event log is session-local.
- Implements arbitrary expressions, scripts or a general workflow language.
- Turns every observed fact directly into a command, or infers success from turn ends.
- Expands capabilities from untrusted data: prompts, payloads, event history and
  configuration cannot widen what the extension does (SPEC §18).

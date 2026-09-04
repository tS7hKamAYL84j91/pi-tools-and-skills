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

## Operator Status and TUI Inspection

`pi-event-loop` provides native Pi TUI components and non-TUI fallbacks for operator visibility (SPEC §16; TODO P13):

- **Persistent status indicator:** updates `ctx.ui.setStatus("pi-event-loop", ...)` with callback theme colors (running/paused state with reason, active command, and queued count). Cleared on session shutdown, reload, or when inert.
- **Bounded on-demand inspection overlay:** interactive `EventLoopInspector` rendered via `ctx.ui.custom()` with `{ overlay: true }` (width 80%, minWidth 40, maxHeight 80%, margin 1). Organizes inspection into 3 tabs:
  - `[1] Status`: profile, pause reason, automated turns counter, active command, pending count, event count.
  - `[2] Views`: todo rows per projection with status and key; Enter toggles gradual disclosure of source payloads.
  - `[3] History`: ordered event log; Enter toggles payload detail.
  - Navigation: `↑/↓` scroll, `1/2/3` or `Tab` switch tab, `Esc` or `q` close. Overflow cues (`[Showing X of Y...]`) appear when rows exceed visible height.
- **Non-TUI fallback:** When `ctx.hasUI === false` or `ctx.mode !== "tui"`, inspection formats bounded multiline plain text (`formatEventLoopFallback`) suitable for RPC or print mode.
- **Pure render paths:** Render closures consume precomputed immutable state only; synchronous filesystem access and raw ANSI codes are forbidden, enforced by architecture fitness test `tests/architecture/tui-render-paths.ts`.
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

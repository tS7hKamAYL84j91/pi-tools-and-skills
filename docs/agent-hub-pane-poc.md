# Agent Hub status side-pane PoC

Status: Jim directly authorized implementation in the specified worktree, a live demo in the pi-tools tab, compact Hub-style rows/colours, and then keyboard/mouse focus navigation. Wider rollout and agent reloads remain separately gated. Usage and implementation limits are in [scripts/README.md](../scripts/README.md#agent-hub-side-pane-poc).

Revision 2 (2026-11-03): aligned to the view CLI contract the CoAS half already committed in `da9d685` (`--scope`, `--json`, exit 3, row set, registry hygiene). Where this document and that contract disagree, the contract wins and this document is corrected.

Revision 3 (Jim's direct live-feedback requests): human rows are `<glyph> - <name> - <status>` with Hub dark-theme colours. Details remain in JSON. The side pane may focus a uniquely identified agent terminal in its own tab/session on Enter or a row click; it still never mutates agent state. This narrowly supersedes the original display-only restriction.

## Goal

Show the agents associated with one EO Zellij tab, including their current sessions, in a compact read-only side pane. Agent Hub remains the source of truth. Herdr is UX inspiration only, not a runtime dependency or alternative state store.

## Ownership and work locations

- pi-tools-and-skills owns the reusable terminal view and Hub data adapter: `/home/jim/git/worktrees/agent-hub-pane/pi-tools`, branch `feature/agent-hub-pane-poc`.
- CoAS owns optional placement and launch through its existing manifest/layout renderer: `/home/jim/git/worktrees/agent-hub-pane/coas`.
- No edits to canonical working trees or their uncommitted work. No push, merge, agent restart, dependency installation into the live runtime, or configuration changes. Jim approved only the pi-tools-tab demo pane launch/refresh; no other live panes are changed.
- Read repository AGENTS.md, existing Hub modules/tests, and applicable installed Pi documentation before implementation. Reuse existing UI/read utilities wherever suitable.

## Minimal deliverable

One terminal command, not another agent or extension registration, with explicit lead scope, an interactive refresh display, and deterministic `--once` output for tests and diagnostics. No model/provider calls, agent registration, heartbeat, mailbox consumption, network service or persistent cache.

Proposed interface (agreed with CoAS in `da9d685`):

```text
pi-agents-pane --scope <canonical-lead> [--registry <dir>] [--interval <seconds>]
               [--once] [--json] [--no-color]
```

- Entry point is `scripts/pi-agents-pane` in this repository, executable, with a shebang that works from a foreign working directory. CoAS resolves it as `<PI_TOOLS_DIR>/scripts/pi-agents-pane` or `COAS_AGENT_PANE_COMMAND`.
- `--once` renders one frame and exits. `--json` implies `--once` and is for tests/diagnostics.
- `--registry` overrides `~/.pi/agents` so fixtures need no live registry.
- Long-running by default, redrawing every `--interval` (default 2 s). A read error renders `registry unreadable: …` and retries; it must not exit or take the tab down.
- Do not assume a globally installed TypeScript runner or a build step at launch. Document the actual command.

## Display and Herdr influence

Borrow compact agent hierarchy, clear textual status alongside color, and grouped session metadata. Do not claim to reproduce Herdr functionality.

Example, illustrative only:

```text
demo · hub
R - quartermaster - running
W - reviewer - waiting
q quit
```

- Show lead and scoped helpers as compact glyph/name/status rows. Model, pending count, absolute heartbeat and current session ID remain in JSON; unavailable titles are null. Do not invent a last-action timestamp.
- Preserve useful information at 30–40 columns; truncate safely and respect terminal height/resize. Include non-TTY/no-color output.
- Avoid busy repainting: a modest refresh interval (e.g. two seconds) is sufficient. Stop cleanly on q, SIGINT and SIGTERM and restore terminal state.
- With valid Zellij context, arrows or j/k select, Enter or a left-click focuses the row's terminal. Keep the same row text, highlighting the selection. Restore mouse reporting/raw mode/cursor on exit; pause redraw while unfocused.

## Scope and identity contract

- `--scope` denotes trusted canonical launch identity, not an arbitrary session title or mutable display alias.
- Use Hub's existing identity/ownership rules to resolve the lead; inspect `declared_name`, namespace and parent linkage rather than implementing display-name substring matching.
- Row set, exactly: the lead record (no namespace, `declared_name == scope`, with a `name == scope` legacy fallback) plus every record whose `namespace == scope`. Exclude `kind: "external"` rows from this pane.
- Do not include an unrelated agent just because it shares a cwd or a similarly prefixed name. Do not browse `inbox/new`; message counts come from existing record fields only.
- Resolve ambiguity conservatively: show an explicit unresolved/ambiguous scope state; never fall back to showing all agents.
- If the lead is down, exact-namespace helpers may remain visible, but mark the lead unavailable. Do not promote a helper to lead or accept an external alias impersonating a reserved label.
- CoAS passes the tab's canonical lead identity from the manifest. Logical Hub membership does not prove physical pane placement: show spawned helpers as associated agents, not falsely as Zellij panes.

## State and session contract

Existing sources to inspect include `lib/agent-registry.ts`, Hub registry/health/UI code, ownership resolution and existing session readers. `AgentRecord` currently exposes status/model/heartbeat, parentId/namespace/declared_name and optional sessionDir/sessionFile; session titles are not guaranteed fields.

- Reuse existing schemas and semantics; no second registry or status engine.
- Registry hygiene: ignore `namespace-owners.json` and `<id>/` directories; read only `*.json` record files.
- Audit readers for side effects: notably `Registry.readAllPeers()` is documented to reap dead records. Do not call mutation-producing readers from the monitor. If necessary, extract a minimal non-mutating read primitive shared with existing code.
- Report `live` / `stale` / `unknown` from heartbeat age and process liveness, checking process start time against `startedAt` so a reused pid is not attributed to an agent.
- Unreadable registry: exit `3` with a JSON error object under `--json`; in the long-running view, render the error and keep retrying.
- Reading status must not update stall counters, reap records, repair permissions, create directories or refresh heartbeat.
- Current session only: resolve title/ID with existing metadata utilities when bounded and safe. Missing metadata displays unavailable; do not substitute agent name as session title.
- No historical-session browser, session switching/resume, transcripts, prompt previews or session-content indexing in this PoC.
- Bound reads and handle disappearing/malformed records, partial session writes and stale timestamps without crashing or hiding all healthy entries.
- A running process or fresh heartbeat is not proof of scientific progress. Retain distinctions among reported status, stale observation and unavailable process evidence.

## Focus-only navigation (revision 3)

- Agents self-report optional `zellij: { sessionName, paneId }` on ordinary Hub registry writes, including registration/heartbeat. Interactive terminals only; headless/RPC agents and children with `parentId` must not advertise inherited parent panes. Old records without metadata remain visible but not focusable until updated Hub code is loaded by those agents.
- The view reads only its own three Zellij environment keys. No other process's environment is inspected. Identity is navigation data, never authority.
- The only subprocess is a bounded, shell-free `zellij` call: `list-panes --json --all` for validation, or `focus-pane-id terminal_N` on explicit user input. The session argument comes from the view's own environment, never from a record.
- Find the view's unique non-plugin terminal first; targets must be unique non-plugin terminals in that exact tab/session, not the view itself. Use explicit self-reported IDs; cwd only corroborates them, never selects a target. No title/cwd guessing.
- Refuse missing/ambiguous metadata, duplicate pane claims, dead/unknown process evidence, future/older-than-30-second heartbeats, changed cwd, failed listing or failed focus. No tab/session switching, agent signals, restarts, messages or registry writes. Missing Zellij disables navigation but keeps the list usable.
- This is not an ownership proof: a fresh record and list snapshot cannot atomically exclude a terminal exiting/reusing its ID between validation and focus. Same-tab-only validation bounds this navigation race; no action beyond focus follows it.
- Multiple namespace-less canonical claimants remain visible as ambiguous; renaming a display name does not elect a unique owner.

## Security and resource boundaries

Agent state remains read-only; focus is not an authorization surface. Do not read credentials or other processes' environments, acquire locks as a coordinator, consume inboxes, send messages, stop processes or grant access. Display only the selected metadata. Sanitize all terminal-bound names/titles/model strings, including ANSI, OSC hyperlinks, control characters and embedded newlines. No raw log dumps on errors.

## CoAS integration boundary

CoAS adds an opt-in side pane using the existing renderer/template and normal caller argv, preserving current layout chrome, tools and credential suppression. Defaults remain unchanged. No new setup path. The monitor must not receive Matrix credentials gratuitously. Any live tab demonstration requires separate approval; fixtures do not prove live role/model acceptance.

## Acceptance tests

1. Fixtures with two leads, mutable display names, exact namespaces, descendants and lookalike/external names show only the requested scope.
2. Missing/ambiguous lead, stale/dead entries and malformed/disappearing records are explicit and handled safely.
3. Session title/ID comes from supported metadata; missing session data is marked unavailable. No transcript content is rendered.
4. Before/after fixture filesystem snapshots prove reads do not create, delete or change registry, ownership, session or mailbox data; no health counter side effects.
5. Narrow width, terminal resize, non-TTY, Unicode and malicious control-sequence fixtures render safely. Refresh and exit release timers and restore terminal state.
6. `--once` exits promptly with deterministic fixture output and works from a foreign cwd using the documented runner; `--json` implies `--once` and an unreadable registry exits `3` with a JSON error object.
7. Registry hygiene: `namespace-owners.json` and `<id>/` directories are ignored, and `kind: "external"` rows never appear.
8. CoAS dry-run/render tests prove opt-in-only placement, correct canonical scope, unchanged default layout and preserved launch/security argv.
9. Stubbed Zellij tests prove same-tab/session-only focus, refusal cases, exact argv, fragmented mouse/keyboard input, quiet-after-focus and mouse/raw/cursor restoration. Tests never invoke a live Zellij session.
10. Run `npm run check`, relevant tests and full `npm test` when practical, plus `git diff --check`. Report exact commands/results and limitations; do not weaken checks.

## Handoff

Provide commits limited to this worktree, exact runnable command, a small fixture demonstration, test results and remaining limitations. Q reviews the integration; Jim authorizes implementation and any later live preview separately. No management framework, historical browser or agent-control features are prerequisites for this PoC.

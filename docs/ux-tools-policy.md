# UX and Tools Policy

Cross-extension TUI consistency and command namespace policy.

---

## TUI Consistency

### Target affordance pattern

```
╭────────────────────────────╮
  <Accent Bold Title> — optional count/state
  <optional search/input>
  <content/list/detail>
  <dim help text>
╰────────────────────────────╯
```

### Standard interaction rules

- `esc` closes or cancels.
- `↑/↓` navigates lists.
- `enter` selects or opens detail.
- `/` starts filtering in list browsers.
- `>` marks selection independent of color.
- Use theme colors only; avoid raw ANSI.
- Never rely on color alone for semantic state.
- Ensure rendered lines do not exceed the provided width.

### Standard overlay options

```ts
{
  overlay: true,
  overlayOptions: {
    width: "70%",
    minWidth: 60,
    maxHeight: "80%",
    anchor: "center",
    margin: 2,
  },
}
```

Exceptions:
- Kanban board: `width: "95%"` for multi-column layout.
- Tiny status-only commands: `ctx.ui.notify(...)` is sufficient.

### Status slot convention

```text
<extension>: <state> [count/details]
```

Examples:
```text
coas: on ✓
matrix: on msg:2
agents: active:1 idle:1
teams: ready
```

### Remaining TUI items

| ID | Item | Status |
|---|------|--------|
| TUX-001 | Selection marker drift | ✅ Done — `>` standardized across all overlays |
| TUX-002 | Kanban width/layout drift | ✅ Done — board clamps to 80 cols |
| TUX-003 | Glyph/status convention | ✅ Done — ASCII markers, `msg:N` counts |
| TUX-004 | Overflow indicators | ✅ Done — `...+N` on hidden agents, `DONE N+M` |
| TUX-005 | Dense-view interaction parity | ✅ Done — Kanban `/` filter; Panopticon unread urgency sort; picker hints audited |

### References

- `docs/adr/005-shared-selection-marker.md`
- `docs/adr/006-teams-reference-pattern.md`
- `docs/adr/007-selection-state-non-color.md`
- `docs/adr/008-browser-toggle-search.md`
- `skills/tui-design/SKILL.md`

---

## Tools and Command Namespace

### Naming conventions

- **Slash commands:** kebab-case (`/teams`, `/agents`, `/coas-status`)
- **Model tools:** `snake_case` with module prefix (`kanban_claim`, `coas_status`)
- **Stems:** commands and tools may share stems without forcing one-to-one parity
  (e.g. `/teams` + `team_describe`, `team_run`)

### Tool disclosure and result conventions

- Default tool output should be compact and safe for model context.
- Provide explicit expansion parameters such as `task_id`, `id`, `detail="full"`, or `full=true` for larger views.
- Keep human-readable `content` concise; put durable machine-checkable state in `details`.
- Expected guard failures should prefer structured result codes/details over ambiguous prose.
- Use thrown errors for invalid inputs or exceptional failures; use code-bearing details for normal empty/no-op/guard outcomes.

Reference pattern: `kanban_snapshot` returns compact board state by default and requires `task_id` or `detail="full"` for expanded context.

### Policy

- Extension commands must not collide with built-in pi commands (exact match).
- Commands with shared prefixes must have predictable exact-match behavior.
- `scripts/builtins.json` is the source of truth for built-in commands.
- `npm run check:namespace` enforces exact-collision policy.

### ADRs

- `docs/adr/009-reserved-command-names.md`
- `docs/adr/010-name-canonical-identity.md`
- `docs/adr/011-command-stem-parity.md`
- `docs/adr/012-programmatic-naming-tool.md`
- `docs/adr/013-name-overrides-spawn.md`

### Remaining work

| Phase | Step | Status |
|-------|------|--------|
| 1 | Remove `/alias`, add `set_name`, heartbeat sync | ✅ Done |
| 1 | Registry schema includes `spawn_name` | ✅ Done |
| 2 | Name precedence and revert logic | ✅ Done — session/programmatic > spawn > generated; clearing session reverts to spawn/generated |
| 2 | Orchestration call-site audit (route by stable ID) | ✅ Done — duplicate display names use stable `#id6` selectors; raw duplicates are ambiguous |
| 3 | Namespace audit (`npm run check:namespace`) | ✅ Done |
| 3 | Document naming conventions | ✅ Done |
| 4 | Remove deprecated `set_alias`/`get_alias` wrappers | ✅ Done — wrappers removed after deprecation window; use `set_name`/`get_name` |

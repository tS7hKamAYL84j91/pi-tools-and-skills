# TODO — Remaining Work

Single tracker for all active work on `pi-tools-and-skills`.

Progress markers:
- `[ ]` Planned
- `[~]` In progress
- `[R]` Ready for review
- `[x]` Done
- `[!]` Blocked

---

## 1. Extension rename for naming consistency

Renaming `kanban` → `pi-kanban` and `matrix` → `pi-matrix` to match the
`pi-*` prefix convention used by `pi-coas`, `pi-panopticon`, and `pi-teams`.

### Scope

| Change | From | To | Risk |
|--------|------|-----|------|
| Directory | `extensions/kanban/` | `extensions/pi-kanban/` | Medium — many imports |
| Directory | `extensions/matrix/` | `extensions/pi-matrix/` | Medium — many imports |
| Tool prefix | `kanban_*` | `kanban_*` or `pi_kanban_*` | Low — keep `kanban_` for model tools |
| Tool prefix | `matrix_*` | `matrix_*` or `pi_matrix_*` | Low — keep `matrix_` for model tools |
| Slash command | `/kanban` | `/kanban` or `/pi-kanban` | Medium — decide on command rename |
| Slash command | `/matrix` | `/matrix` or `/pi-matrix` | Medium — decide on command rename |
| Status slot | `kanban:` | `pi-kanban:` | Low |
| Status slot | `matrix:` | `pi-matrix:` | Low |
| Config dir | `~/.kanban` | `~/.pi-kanban` | Low |
| Config dir | `.matrix` | `.pi-matrix` | Low |
| Tests | `tests/kanban-*.test.ts` | `tests/pi-kanban-*.test.ts` | Medium |
| Tests | `tests/matrix-*.test.ts` | `tests/pi-matrix-*.test.ts` | Medium |
| Docs | `docs/kanban-extension.md` | `docs/pi-kanban-extension.md` | Low |

### Decisions needed

1. **Command names:** Rename `/kanban` → `/pi-kanban` and `/matrix` → `/pi-matrix`, or keep old names for backward compat?
   - Recommendation: keep `/kanban` and `/matrix` as aliases; status slot and config dirs use `pi-*` names.
2. **Model tool prefixes:** Keep `kanban_claim` or rename to `pi_kanban_claim`?
   - Recommendation: keep `kanban_` prefix — model tools don't need `pi_` prefix since they're already namespaced by the tool system.
3. **Config dir migration:** If existing `~/.kanban` exists, auto-migrate or require manual rename?
   - Recommendation: auto-migrate on first load with a warning.

### Validation

- `npm run check` (typecheck, lint, knip, type-coverage)
- `npm test`
- `npm run check:namespace` — verify no command collisions introduced
- Manual: `/kanban`, `/matrix`, and all tools still work with aliases

---

## 2. Tools namespace — Phase 2: name precedence and revert logic

Status: `[ ]` Planned

| Step | Description | Risk |
|------|-------------|------|
| 2.1 | Implement name precedence: user/programmatic > spawn > generated fallback | Medium |
| 2.2 | Implement clear/revert: if session name cleared, registry reverts to `spawn_name` | Medium |
| 2.3 | Add disambiguation: if two agents share a `/name`, registry shows stable ID suffix | Low |
| 2.4 | Audit orchestration call sites that route by registry name | Medium |

### References

- `docs/ux-tools-policy.md`
- `docs/adr/010-name-canonical-identity.md`
- `docs/adr/013-name-overrides-spawn.md`

---

## 3. Tools namespace — Phase 4: remove deprecated wrappers

Status: `[ ]` Planned — scheduled for two releases after Phase 1

| Step | Description |
|------|-------------|
| 4.1 | Remove `set_alias` deprecated wrapper |
| 4.2 | Remove `get_alias` deprecated wrapper |
| 4.3 | Update any documentation referencing alias tools |

Blocked by: Phase 2 completion and a deprecation window.

---

## 4. TUI — Dense-view interaction parity (TUX-005)

Status: `[ ]` Planned — deferred

| Surface | Action | Priority |
|---------|--------|----------|
| Kanban board | Add `/` search/filter by task id/title/agent, or document why not | Medium |
| Panopticon overlay | Add unread-message filtering or urgency sort | Low |
| All overlays | Normalize any remaining picker hint wording drift | Low |

### References

- `docs/ux-tools-policy.md`
- `docs/adr/005-shared-selection-marker.md`
- `docs/adr/006-teams-reference-pattern.md`

---

## Backlog (evidence-gated)

These items only activate when a concrete user-visible gap or failing fitness
function demands them. See `docs/teams-platform.md` for evidence-gate criteria.

| Area | Item | Gate |
|------|------|------|
| Teams platform | New topology handler | User workflow cannot fit council/pair-coding |
| Teams platform | Live-agent lifecycle control | Session event model insufficient |
| Teams platform | External graph/workflow framework | Spike proves code reduction |
| CoAS scheduler | External schedule execution | Operational need outside pi |
| Panopticon | Historical metrics | User-visible gap |
| Kanban | SQLite backend | FIRE review says No |

---

## Notes

- This file is the single source of truth for planned work. Prior items are in
  `docs/adr/` (accepted decisions) and `docs/archive/` (completed work in git
  history).
- For architecture context, see `docs/architecture.md`.
- For teams standing decisions, see `docs/teams-platform.md`.
- For TUI/tool policy, see `docs/ux-tools-policy.md`.

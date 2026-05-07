# TODO — Remaining Work

Single tracker for all active work on `pi-tools-and-skills`.

**🔴 AUTONOMY RULE — READ FIRST:**
The implementation agent (mahwir) is expected to complete outstanding items
**without asking the user for confirmation**. This is a standing instruction.

- **Pick work from this TODO**, implement it, validate it, and push it.
- **Review with gravitas** (your agent peer) or the **navigator team**
  (`team_run` with `navigator`) for correctness and scope.
- **Escalate architecture or policy decisions to the LLM Council**
  (`team_run` with `llm-council`) — do not block on user approval.
- **The user is not a gatekeeper.** This TODO is the authority. If an item is
  listed as `[ ]` Planned, execute it. If you are unsure about a design
  choice, use the council or navigator — not the user.
- **Stop only for blockers** marked `[!]`. Everything else is fair game.

Progress markers:
- `[ ]` Planned
- `[~]` In progress
- `[R]` Ready for review
- `[x]` Done
- `[!]` Blocked

---

## How to use this TODO

An implementation agent must follow this workflow for every item:

1. **Claim an item** — change its marker from `[ ]` to `[~]` and add a dated
   note with intended scope.
2. **Implement the smallest useful change** — run focused validation:
   ```bash
   npm run check   # typecheck → lint → knip → type-coverage
   npm test        # vitest
   ```
3. **Do a refactor pass** — remove duplication, simplify names, keep vertical
   slices independent. Run focused tests again.
4. **Review with `gravitas`** — send a review request including changed files,
   validation output, and decisions made. Address feedback in a focused loop.
5. **Design decisions** — any new architecture or policy decision must be:
   - Reviewed by `team_run` with `llm-council` for high-impact or contentious
     choices.
   - Written as a new ADR in `docs/adr/` with status, context, decision,
     consequences format.
   - Referenced from this TODO and any affected living docs.
6. **Update this file** — change marker to `[R]` when ready for review, then
   `[x]` only after gravitas approval and full validation pass.
7. **If blocked** — change marker to `[!]`, record blocker and next decision
   needed, then stop rather than broadening scope.

---

## 1. Extension rename for naming consistency

Status: `[x]` Done — renamed, all tests pass

Renaming `kanban` → `pi-kanban` and `matrix` → `pi-matrix` to match the
`pi-*` prefix convention used by `pi-coas`, `pi-panopticon`, and `pi-teams`.

### Completed changes

| Change | From | To | Status |
|--------|------|-----|--------|
| Directory | `extensions/kanban/` | `extensions/pi-kanban/` | ✅ |
| Directory | `extensions/matrix/` | `extensions/pi-matrix/` | ✅ |
| Tool prefix | `kanban_*` | kept `kanban_*` | ✅ |
| Tool prefix | `matrix_*` | kept `matrix_*` | ✅ |
| Slash command | `/kanban` | kept `/kanban` | ✅ |
| Slash command | `/matrix` | kept `/matrix` | ✅ |
| Status slot | `kanban:` | `pi-kanban:` | ✅ |
| Status slot | `matrix:` | `pi-matrix:` | ✅ |
| Board dir fallback | `kanban/` | `pi-kanban/` (with legacy check) | ✅ |
| Config key | `matrix` | `pi-matrix` | ✅ |
| Tests | `kanban-*.test.ts` | `pi-kanban-*.test.ts` | ✅ |
| Tests | `matrix-*.test.ts` | `pi-matrix-*.test.ts` | ✅ |
| Package script | `OWNED_EXTENSION_DIRS` | updated | ✅ |

### Validation

- `npm run check` (typecheck, lint, knip, type-coverage) — ✅
- `npm test` (40 files, 465 tests) — ✅
- `npm run check:namespace` — ✅ no collisions introduced

> Keep `/kanban` and `/matrix` commands for backward compat.
> Model tool prefixes (`kanban_*`, `matrix_*`) unchanged.
> Legacy board dir `kanban/` checked before `pi-kanban/` fallback.
- `npm test`
- `npm run check:namespace` — verify no command collisions introduced
- Manual: `/kanban`, `/matrix`, and all tools still work with aliases

---

## 2. Tools namespace — Phase 2: name precedence and revert logic

Status: `[x]` Done — 2026-05-07 mahwir implemented precedence/revert, duplicate-name display suffixes, and routing audit; gravitas approved; `npm run check` and `npm test` pass.

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

Status: `[x]` Done — 2026-05-07 mahwir removed deprecated alias tool wrappers, updated references/tests, passed gravitas review, and `npm run check`/`npm test` passed.

| Step | Description |
|------|-------------|
| 4.1 | Remove `set_alias` deprecated wrapper | ✅ Done |
| 4.2 | Remove `get_alias` deprecated wrapper | ✅ Done |
| 4.3 | Update any documentation referencing alias tools | ✅ Done |

Validation: `npm run check` ✅; `npm test` ✅; gravitas review ✅.

---

## 4. TUI — Dense-view interaction parity (TUX-005)

Status: `[x]` Done — 2026-05-07 mahwir added Kanban `/` filtering, Panopticon unread urgency sort, audited hint wording, passed review with gravitas, and `npm run check`/`npm test` passed.

| Surface | Action | Priority | Status |
|---------|--------|----------|--------|
| Kanban board | Add `/` search/filter by task id/title/agent | Medium | ✅ Done |
| Panopticon overlay | Add unread-message urgency sort | Low | ✅ Done |
| All overlays | Normalize any remaining picker hint wording drift | Low | ✅ Done — hints audited; Panopticon now advertises unread-first ordering |

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
| Teams platform | New topology handler | User workflow cannot fit council |
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

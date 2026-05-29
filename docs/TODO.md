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
| Board dir fallback | `kanban/` legacy check | strict `pi-kanban/` | ✅ |
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
> Legacy board dir `kanban/` fallback removed in item 7; strict `pi-kanban/` is now the baseline.

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

## 5. Panopticon — Reconciliation alert noise reduction

Status: `[x]` Done — 2026-05-09 mahwir implemented sparse/actionable reconciliation alerts, gravitas approved, and `npm run check`/`npm test` passed.

Repeated reconciliation alerts currently consume tokens during idle periods even
when agents are healthy. `agent_status` often shows agents as `waiting` or
`active` with fresh heartbeats and no pending messages, so follow-up chat turns
add no operational value.

### Goal

Make reconciliation alerts actionable and sparse: suppress or batch idle/fresh
heartbeat checks, and only interrupt the conversation for states that likely
need intervention.

### Planned changes

| Step | Description | Risk |
|------|-------------|------|
| 5.1 | Classify reconciliation findings into actionable vs informational | ✅ Done |
| 5.2 | Suppress repeated `stale-activity` alerts when all agents are `waiting` or non-stalled `active` with fresh heartbeats and no messages pending | ✅ Done |
| 5.3 | Confirm stale heartbeat findings with a fresh, non-blocking registry/status read before notifying | ✅ Done |
| 5.4 | Keep alerts for `blocked`, true `stalled`, terminated-without-DONE, and pending messages | ✅ Done |
| 5.5 | Add tests for idle suppression, stale-worker confirmation, and actionable alerts | ✅ Done |
| 5.6 | Update Panopticon/orchestration docs and skills with the final policy | ✅ Done |

### Acceptance criteria

- Idle or long-running healthy agents with fresh heartbeats do not trigger
  repeated user-visible reconciliation messages.
- One stale registry sample is not enough to notify if a follow-up status read
  shows a fresh heartbeat.
- Actionable conditions still notify promptly: pending messages, blocked agents,
  true stalls, and silent termination.
- `npm run check` and `npm test` pass.

### References

- `extensions/pi-panopticon/skills/pi-agent-orchestration/SKILL.md`
- `extensions/pi-panopticon/health.ts`
- `extensions/pi-panopticon/registry.ts`
- `docs/adr/014-panopticon-reconciliation-alert-policy.md`

---

## 6. Update F.I.R.E. Architecture Review in Docs

Status: `[x]` Done — 2026-05-09 mahwir refreshed `docs/architecture.md` F.I.R.E. baseline for completed `pi-teams`, alias-wrapper removal, Panopticon ADR 014, and `pi-matrix` IPC-boundary guidance; gravitas approved; `npm run check` and `npm test` pass.

The F.I.R.E. review section in `docs/architecture.md` was dated 2026-05-04 and listed several completed items as ongoing risks or mitigations (e.g., `pi-teams` DAG).

### Goal

Refresh the architecture docs to reflect the completed state of recent refactors, cementing the new baseline.

### Planned changes

| Step | Description | Risk |
|------|-------------|------|
| 6.1 | Update F.I.R.E. review date to current. | ✅ Done |
| 6.2 | Move `pi-teams` DAG removal from mitigation to established baseline. | ✅ Done |
| 6.3 | Add Panopticon noise reduction (ADR 014) as a token-cost mitigation under "Inexpensive". | ✅ Done |
| 6.4 | Note the completed removal of alias tools. | ✅ Done |

### Acceptance criteria

- `docs/architecture.md` accurately reflects the current F.I.R.E. state of the codebase.

---

## 7. Remove legacy `kanban/` directory fallback

Status: `[x]` Done — 2026-05-09 mahwir removed legacy unprefixed Kanban directory resolution, updated user-facing path text/docs, added regression tests, gravitas approved, and `npm run check`/`npm test` pass.

With the extension rename to `pi-kanban` complete and stabilized, the backward-compatibility fallback checking for the old `kanban/` directory can be removed to enforce strict restraint.

### Goal

Simplify the Kanban directory resolution logic by strictly using `pi-kanban/`.

### Planned changes

| Step | Description | Risk |
|------|-------------|------|
| 7.1 | Remove the legacy fallback directory check in `extensions/pi-kanban/` (e.g., in board/watcher initialization). | ✅ Done |
| 7.2 | Update or remove any tests asserting the legacy fallback behavior. | ✅ Done |

### Acceptance criteria

- Kanban extension strictly uses `pi-kanban/` without checking for the un-prefixed directory.
- `npm run check` and `npm test` pass.

---

## 8. Extension UX Improvements

Single tracking group for the identified visual, interaction, and structural UX enhancements across all extensions.

| Step | Description | Status |
|------|-------------|--------|
| 8.1 | **Kanban Summary Mode (Collapsed Metrics View):** Toggle vertical column progress bars and active/blocked summaries with `v` or `TAB` in `/kanban`. | `[ ]` Planned |
| 8.2 | **Kanban Summary Drill-Down:** Support selecting a collapsed column and pressing `enter` to expand and browse only its tasks. | `[ ]` Planned |
| 8.3 | **Panopticon Navigation Loop (Detail ➔ List):** Add a nested navigation state machine or `backspace` keybind in `/agents` to go back to directory from details. | `[ ]` Planned |
| 8.4 | **Panopticon Fuzzy Filtering:** Add filter input triggerable by `/` inside `/agents` directory list to handle long agent lists. | `[ ]` Planned |
| 8.5 | **Interactive CoAS Command Browsers:** Migrate `/coas-workspaces` and `/coas-schedules` to interactive `SelectList` lists. | `[ ]` Planned |
| 8.6 | **Standardized Scroll & Truncation Visual Cues:** Add a shared text truncation layout standard (`[Showing N of M - scroll ↓]`) in `docs/ux-tools-policy.md`. | `[ ]` Planned |
| 8.7 | **Standardized Destructive Confirmation Modals:** Unify delete/kill overlays under standard warning borders and keybinds (`y` to confirm). | `[ ]` Planned |
| 8.8 | **Goal Clear Command Shorthand:** Register direct `/goal-clear` slash command and update validation/test coverage. | `[x]` Done |

### References

- `docs/ux-tools-policy.md`
- `extensions/pi-goal/goal-extension.ts`
- `tests/extension-registration.test.ts`

---

## Backlog (evidence-gated)

These items only activate when a concrete user-visible gap or failing fitness
function demands them. See `docs/teams-platform.md` for evidence-gate criteria.

| Area | Item | Gate |
|------|------|------|
| Teams platform | Live-agent lifecycle control | Session event model insufficient |
| Panopticon | Operational metrics | Need to answer concrete coordination questions such as who is stuck, erroring, or carrying unread backlog; compute from existing registry/session state, no long-term metrics store |

---

## Notes

- This file is the single source of truth for planned work. Prior items are in
  `docs/adr/` (accepted decisions) and `docs/archive/` (completed work in git
  history).
- For architecture context, see `docs/architecture.md`.
- For teams standing decisions, see `docs/teams-platform.md`.
- For TUI/tool policy, see `docs/ux-tools-policy.md`.

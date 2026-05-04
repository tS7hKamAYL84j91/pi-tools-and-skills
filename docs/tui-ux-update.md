# Cross-Extension TUI UX Update

Living brief for cross-extension terminal UX consistency across `pi-tools-and-skills`. This complements the per-extension plans (`teams-ux-improvements.md`, `kanban-ux-improvements.md`, `panopticon-ux-improvements.md`, and `coas-ux-improvements.md`) and records validation evidence from `termwright`.

## Goal

Make the TUI surfaces feel like one coherent pi UI system while keeping changes small, local, and compatible with the existing extension architecture.

## Scope

In scope:

- `/teams` browser, detail view, target picker, and model picker.
- `/kanban` board, detail view, confirm-delete, move-picker, and status widget.
- `/agents`/panopticon overlay, status widget, and agent status text output.
- Lightweight Matrix and CoAS status/widget surfaces where they intersect with shared status conventions.
- Selection markers, status glyphs, keyboard hints, search/filter affordances, overflow behavior, and narrow-width resilience.
- Headless terminal validation with `termwright`.

Out of scope:

- Changing task, team, agent, Matrix, or CoAS runtime semantics.
- Replacing `pi-tui` or introducing a new UI framework.
- Broad visual redesign or theme work.
- Treating glyph polish as a blocker for functional changes.

## Constraints

- KISS/YAGNI: prefer shared helpers or small local edits over broad rewrites.
- Follow `skills/tui-design/SKILL.md`: do not rely on color alone; test narrow layouts; avoid emoji for layout-critical meaning; provide graceful fallbacks.
- Use `/teams` as the current reference implementation for list overlays: `Container`, `Text`, `Input`, `SelectList`, `DynamicBorder`, theme-aware rendering, keyboard-only operation, and `>` selected-row marker.
- Preserve good existing architecture, especially Kanban's controller/view split and watcher cleanup.

## Verdict

The TUI surface is broadly functional. The issue is not systemic rendering failure; it is cross-surface coherence drift.

`pi-teams` is the strongest reference implementation. Kanban and panopticon are usable, but they diverge in marker choice, glyph/status conventions, component usage, overflow handling, and search/action affordances.

## Termwright Validation

Validated on 2026-05-04 with `termwright` from `$HOME/.cargo/bin/termwright`.

Setup used a live pi session with a temporary Kanban board:

```bash
termwright daemon --background --socket /tmp/termwright-pi-ux.sock \
  --cols 100 --rows 30 -- \
  /bin/bash -lc 'cd /Users/jim/git/pi-tools-and-skills && KANBAN_DIR=/tmp/pi-termwright-kanban-review PI_OFFLINE=1 pi --no-session --model ollama/glm-5.1:cloud'
```

Text captures were saved under `/tmp` during validation:

- `/tmp/tw-teams-browse.txt`
- `/tmp/tw-teams-search.txt`
- `/tmp/tw-kanban-board.txt`
- `/tmp/tw-kanban-move.txt`
- `/tmp/tw-kanban-80.txt`
- `/tmp/tw-agents.txt`

### Validation results

| Surface | Size | Result | Evidence |
| --- | --- | --- | --- |
| Teams browser | 100×30 | ✅ Pass | Selected row uses `>`; hint shows `↑/↓ select · enter details · f form · m models · d delete · / filter · esc close`. |
| Teams search | 100×30 | ✅ Pass | `/` opens filter input; typing `pair` narrows the list; selected row still uses `>`; empty/search text remains readable. |
| Kanban board | 100×30 | ⚠️ Usable with drift | Board renders, but selected row uses `▶`, header uses `📋`, and card layout is manually drawn rather than component-based. |
| Kanban move-picker | 100×30 | ⚠️ Usable with drift | Move-picker renders, but uses `↷` and only offers `[1] backlog   [2] todo` for an in-progress task. |
| Kanban board narrow | 80×24 | ❌ Fails narrow-width resilience | Board content overruns/clips: header truncates at `m mov`, `DONE` header clips, and right border/column alignment degrades. |
| Panopticon status strip | 100×30 / 80×24 | ⚠️ Needs follow-up | Status strip rendered, but remains glyph-heavy and can truncate with many agents. Direct `/agents` overlay validation was inconclusive in this resumed session due command/autocomplete/runtime behavior; validate overlay separately before changing it. |

Caveats:

- `termwright` validation confirms the major visual/coherence findings; it does not replace code review for lifecycle cleanup or internal component focus behavior.
- The observed `/agents` command behavior should not be over-interpreted as a panopticon overlay failure without a focused reproduction.
- Earlier tmux captures showed `/agents` overlay rendering successfully; this update treats panopticon overlay findings as code-review plus partial terminal evidence.

## Status

| Issue | Decision | Implementation | Validation | Status |
| --- | --- | --- | --- | --- |
| TUX-001 selection marker drift | Adopt `>` as shared selected-row marker | Teams done; Kanban/panopticon pending | Termwright confirms Teams `>` and Kanban `▶` | Open |
| TUX-002 Kanban component/layout drift | Keep architecture, improve layout robustness | Pending | Termwright confirms 80×24 clipping | Open |
| TUX-003 glyph/status convention drift | Normalize markers and fallback strategy | Pending | Termwright shows emoji/powerline-heavy status and Kanban layout glyphs | Open |
| TUX-004 overflow and hidden data | Add explicit `+N`/overflow indicators | Pending | Code review + status strip truncation risk | Open |
| TUX-005 dense-view interaction parity | Use Teams search/action affordances as precedent | Teams done; Kanban/panopticon pending | Termwright confirms Teams search works | Open |

## Issues

### TUX-001 — Selection marker drift across list-like views

**Observation:** The same selected/focused concept is rendered differently across surfaces.

- Teams: `>`
- Kanban: `▶`
- Panopticon `SelectList`: pi-tui default `→`

**Desired outcome:** Selected rows use one non-color marker everywhere, preferably `>` because it is ASCII-safe and already validated in Teams.

**Candidate acceptance criteria:**

- Teams, Kanban, panopticon overlays, and future pickers all use `>` for selected rows.
- Color/bold are secondary cues only.
- Plain-text `termwright` captures preserve selected-row meaning.

### TUX-002 — Kanban layout is functional but less aligned with shared TUI patterns

**Observation:** Kanban has a clean controller/view split and good cleanup behavior, but renders most UI as hand-built strings and box characters. At 80×24, `termwright` captured clipped header/column content and degraded right-edge alignment.

**Desired outcome:** Preserve Kanban's architecture while making layout behavior as robust and consistent as Teams.

**Candidate acceptance criteria:**

- Final rendered lines are clamped to viewport width.
- Overlay declares a realistic min-width or degrades intentionally below it.
- Confirm-delete and move-picker use `DynamicBorder`/`Text` or equivalent shared layout helpers where practical.
- Kanban widget uses width-aware component rendering where practical.

### TUX-003 — Glyph and status conventions are inconsistent

**Observation:** Status and layout glyphs vary by extension:

- Kanban uses layout emoji/glyphs such as `📋`, `⚠`, `↷`.
- Panopticon uses emoji status symbols and powerline separators.
- Matrix uses `N✉`; panopticon uses `✉N`.
- CoAS mostly uses text plus `✓`/`✗`.

**Desired outcome:** Use a documented shared status convention with color as a secondary cue and graceful fallback for dense or limited terminals.

**Candidate acceptance criteria:**

- Pick one pending-message count format and apply it everywhere.
- Avoid emoji for layout-critical meaning.
- Add plain-text fallback/status summaries for powerline-heavy displays.

### TUX-004 — Overflow and hidden data need explicit indicators

**Observation:** Dense views hide information without always telling the user.

- Kanban `DONE_LIMIT = 10` hides older done cards with no `+N more` indicator.
- Panopticon powerline/status strips can silently truncate when many agents are visible.
- Team picker width values differ (`70` vs `60`), which is minor but part of the same width-policy drift.

**Desired outcome:** If data is hidden due to width or count limits, the UI says so.

**Candidate acceptance criteria:**

- Kanban done column shows `…+N more` or a header count when hidden done cards exist.
- Panopticon status widget appends `…+N` or summarizes hidden agents.
- Overlay min-width and truncation policies are documented and consistent.

### TUX-005 — Dense-view interaction affordances should converge

**Observation:** Teams has a validated `/` fuzzy-filter flow. Kanban and panopticon dense list views do not yet provide comparable search/filter/action affordances.

**Desired outcome:** Use Teams as the precedent for keyboard-only dense navigation, but keep each surface appropriately scoped.

**Candidate acceptance criteria:**

- Kanban supports `/` search/filter by task id/title/agent, or explicitly documents why not.
- Panopticon supports at least unread-message filtering or urgency sorting.
- Overlay hints use consistent wording and separators.
- Action pickers show only valid actions or clearly label workflow constraints.

## ADR Log

### ADR-001 — Use `>` as the shared selected-row marker

**Status:** Proposed

**Context:** Teams already standardized on `>` and `termwright` captures show it survives plain-text capture. Kanban and panopticon still use different markers.

**Decision:** Adopt `>` as the selected-row marker for all extension overlays and pickers. Use color and bold only as secondary affordances.

**Consequences:** Improves plain-text readability and cross-extension consistency. Panopticon may need a small `SelectList` theme adapter similar to Teams until pi-tui exposes a configurable selected prefix.

### ADR-002 — Treat Teams as the reference TUI pattern

**Status:** Proposed

**Context:** Teams has the most complete alignment with the TUI design guidance and pi component philosophy.

**Decision:** New or updated extension overlays should first consider the Teams pattern: composable pi-tui components, explicit keyboard hints, `/` search where useful, `>` marker, and no layout-critical emoji.

**Consequences:** Reduces one-off rendering drift without requiring a broad framework replacement.

## Implementation Plan

1. **Marker normalization** — Change Kanban selected cursor from `▶` to plain `>`; add the Teams `selectedText` replacement to panopticon `SelectList` themes.
2. **Kanban width hardening** — Add final line clamping, min-width policy, and narrow-width `termwright` validation. Keep the controller/view split.
3. **Glyph/status convention pass** — Pick one pending count format; document status markers; reduce layout-critical emoji; add fallback summaries for status strips.
4. **Overflow indicators** — Add Kanban done overflow indicator and panopticon `…+N` truncation indicator.
5. **Interaction parity** — Add Kanban search/filter and panopticon unread filter or urgency sort; normalize hint wording as part of those changes.

## Validation Plan

- `npm run check` after each implementation slice.
- `npm test` after each implementation slice.
- `termwright` captures for:
  - Teams browser/search at 80×24 and 100×30.
  - Kanban board/detail/move/delete at 80×24 and 100×30.
  - Panopticon overlay and status widget with multiple agents at 80×24 and 100×30.
  - CoAS/Matrix status conventions where affected.
- Keep validation text captures or screenshots referenced in the relevant per-extension progress log.

## Progress Log

- 2026-05-04: Cross-extension audit synthesized from independent reviews of Teams, Kanban, Panopticon/CoAS/Matrix, plus default-debate review. Findings: TUI is functional; main issue is coherence drift.
- 2026-05-04: `termwright` became available and was used for live validation. Teams browse/search passed. Kanban rendered at 100×30 but showed marker/glyph/component drift; Kanban failed narrow-width resilience at 80×24. Panopticon status strip rendered but overlay validation needs a focused follow-up due command/session ambiguity.

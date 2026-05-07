# Cross-Extension TUI UX Update

Living brief for cross-extension terminal UX consistency across `pi-tools-and-skills`. This complements the per-extension plans (`teams-ux-improvements.md`, `kanban-ux-improvements.md`, and `coas-ux-improvements.md`) and records validation evidence from `termwright`, including Panopticon status/overlay findings.

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

The TUI surface is broadly functional. The first consistency slice resolved the highest-risk coherence drift: selected markers, layout-critical emoji, narrow Kanban width, pending-message count format, and dense status overflow.

`pi-teams` remains the reference implementation. Remaining work is incremental: CoAS fallback polish, team picker width policy, and optional dense-view search/filter parity.

## Termwright Validation

Validated on 2026-05-04 with `termwright` from `$HOME/.cargo/bin/termwright`.

Setup used a live pi session with a temporary Kanban board:

```bash
termwright daemon --background --socket /tmp/termwright-pi-ux.sock \
  --cols 100 --rows 30 -- \
  /bin/bash -lc 'cd /Users/jim/git/pi-tools-and-skills && KANBAN_DIR=/tmp/pi-termwright-kanban-review PI_OFFLINE=1 pi --no-session --model ollama/glm-5.1:cloud'
```

Text captures were saved under `/tmp` during validation:

Initial audit captures:

- `/tmp/tw-teams-browse.txt`
- `/tmp/tw-teams-search.txt`
- `/tmp/tw-kanban-board.txt`
- `/tmp/tw-kanban-move.txt`
- `/tmp/tw-kanban-80.txt`
- `/tmp/tw-agents.txt`

Follow-up implementation captures:

- `/tmp/tw-teams-browse-new.txt`
- `/tmp/tw-teams-search-new.txt`
- `/tmp/tw-kanban-board-new.txt`
- `/tmp/tw-kanban-move-new.txt`
- `/tmp/tw-kanban-80-new.txt`
- `/tmp/tw-agents-80-new.txt`
- `/tmp/tw-status-80-new.txt`

### Validation results

| Surface | Size | Result | Evidence |
| --- | --- | --- | --- |
| Teams browser | 100×30 | ✅ Pass | Selected row uses `>`; hint shows `↑/↓ select · enter details · f form · m models · d delete · / filter · esc close`. |
| Teams search | 100×30 | ✅ Pass | `/` opens filter input; typing `pair` narrows the list; selected row still uses `>`; empty/search text remains readable. |
| Kanban board | 100×30 | ⚠️ Usable with drift | Board renders, but selected row uses `▶`, header uses `📋`, and card layout is manually drawn rather than component-based. |
| Kanban move-picker | 100×30 | ⚠️ Usable with drift | Move-picker renders, but uses `↷` and only offers `[1] backlog   [2] todo` for an in-progress task. |
| Kanban board narrow | 80×24 | ❌ Fails narrow-width resilience | Board content overruns/clips: header truncates at `m mov`, `DONE` header clips, and right border/column alignment degrades. |
| Panopticon status strip | 100×30 / 80×24 | ⚠️ Needs follow-up | Status strip rendered, but remains glyph-heavy and can truncate with many agents. Direct `/agents` overlay validation was inconclusive in this resumed session due command/autocomplete/runtime behavior; validate overlay separately before changing it. |

### Follow-up validation results

Validated after the first implementation slices on 2026-05-04.

| Surface | Size | Result | Evidence |
| --- | --- | --- | --- |
| Teams browser/search | 100×30 | ✅ Pass | Captures still preserve `>` selection and `/` search behavior. |
| Kanban board | 100×30 | ✅ Pass | Selected card uses `>`; board header no longer uses layout emoji; done header shows `DONE 10+3`. |
| Kanban move-picker | 100×30 | ✅ Pass | Move-picker title is text-only, right border is visible, and only valid backlog/todo move options are shown for a backlog task. |
| Kanban board narrow | 80×24 | ✅ Pass | Max captured line width is 77; board remains aligned; selected card uses `>`; done overflow is visible as `DONE 10+3`. |
| Kanban status widget narrow | 80×24 | ✅ Pass | Widget uses `kanban: wip ...` text, no layout emoji, and no line wrap in the captured status area. |
| Panopticon overlay | 80×24 | ✅ Pass | Overlay validated through `/agents` command selection; selected row uses `>`; status markers are ASCII (`W`, `R`); hints use `·`. |
| Panopticon status widget | 80×24 | ✅ Pass | Footer uses ASCII markers and appends explicit `...+N` when hidden agents remain. |
| Matrix status | 80×24 | ✅ Pass | Footer shows `matrix: off`; pending count convention is implemented as `msg:N` in code. |

Caveats:

- `termwright` validation confirms the major visual/coherence findings; it does not replace code review for lifecycle cleanup or internal component focus behavior.
- Follow-up captures supersede the initial Panopticon ambiguity: `/agents` overlay and status widget were validated at 80×24 after the status convention slice.

## Status

| Issue | Decision | Implementation | Validation | Status |
| --- | --- | --- | --- | --- |
| TUX-001 selection marker drift | Adopt `>` as shared selected-row marker | Teams done; Kanban board done; panopticon overlays done | Unit tests and termwright captures confirm `>` for Teams, Kanban, and Panopticon overlays | Done |
| TUX-002 Kanban component/layout drift | Keep architecture, improve layout robustness | Kanban board now degrades column width at 80 cols; cards and modal borders clamp to viewport | Unit coverage confirms board visible width ≤80; termwright validates 80×24 board and 100×30 move-picker | Done for width hardening; component refactor deferred |
| TUX-003 glyph/status convention drift | Normalize markers and fallback strategy | Kanban board/delete/move/widget layout-critical emoji removed; Panopticon agent status markers and Matrix status are ASCII-safe; pending messages use `msg:N` | `npm run check`, `npm test`, and termwright status captures pass | In progress: CoAS checkmark/cross fallback remains |
| TUX-004 overflow and hidden data | Add explicit `+N`/overflow indicators | Kanban done header shows `+N`; Panopticon status widget shows `...+N` | Unit coverage confirms Kanban done overflow; termwright confirms Kanban `DONE 10+3` and Panopticon `...+N` | In progress: team picker width policy remains |
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

- Pick one pending-message count format and apply it everywhere: `msg:N`.
- Avoid emoji for layout-critical meaning; use short ASCII status markers where space is tight.
- Add plain-text fallback/status summaries for dense displays.

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

Extracted to canonical ADR files:

- `docs/adr/005-shared-selection-marker.md` — Standardize on `>` for all overlays.
- `docs/adr/006-teams-reference-pattern.md` — Teams as the reference TUI pattern.

## Implementation Plan

1. **Marker normalization** — Done for Teams, Kanban, Panopticon agent overlay, and Panopticon list-mode overlay.
2. **Kanban width hardening** — Done for board and modal border clamping; component refactor intentionally deferred.
3. **Glyph/status convention pass** — Done for Kanban, Panopticon, and Matrix; CoAS fallback polish remains.
4. **Overflow indicators** — Done for Kanban done column and Panopticon status widget; team picker width-policy cleanup remains.
5. **Interaction parity** — Done: Panopticon command resolution tests cover `/agents` exact-match (see `docs/adr/009-reserved-command-names.md`). Kanban search/filter remains open; defer until board density warrants it.

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
- 2026-05-04: Implemented first consistency slice: Kanban selected marker changed to `>`, Panopticon `SelectList` selected text maps `→` to `>`, Kanban board/delete/move layout-critical emoji removed, and Kanban board column sizing now degrades to fit 80-column visible width. Validation: `npm run check`, `npm test`, and targeted Kanban render tests passed; follow-up `termwright` recapture completed later the same day.
- 2026-05-04: Implemented status convention slice: Panopticon overlay/status/widget/health output use ASCII status markers, compact separators, explicit `...+N` hidden-agent marker, and `msg:N` pending-message counts; Matrix status uses `matrix: on/off/err` plus `msg:N`. Validation: `npm run check` and `npm test` pass.
- 2026-05-04: Completed termwright recapture pass. Evidence saved under `/tmp/*-new.txt`; Teams browse/search, Kanban board/move/narrow/status, Panopticon overlay/status, and Matrix footer status pass. Also shortened Kanban blocked reason in the widget to avoid 80-column wrapping and clamped Kanban modal borders to restore right-edge alignment.

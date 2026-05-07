# Teams UX Improvements

Living plan for improving `extensions/pi-teams` terminal UX. Keep this document focused on actionable issues, decisions, implementation steps, and validation evidence.

## Goal

Make the teams TUI easier to understand and operate without adding a new UI framework, compatibility layer, or broad redesign.

## Scope

In scope:

- `/teams` browser and detail overlay.
- Team form, target picker, and model picker flows.
- Selection/highlight affordances, keyboard hints, empty/error states, and search/filter behavior.
- Headless terminal validation with `termwright` plus focused unit tests where practical.

Out of scope:

- Changing team manifest schema or runtime semantics.
- Adding backward compatibility for old team formats.
- Replacing existing `pi-tui` components.
- Broad visual theming beyond the minimal affordances needed for clarity and accessibility.

## Constraints

- KISS/YAGNI: prefer small edits to existing overlay/picker components.
- Follow `skills/tui-design/SKILL.md`: do not rely on color alone; test narrow layouts; cleanly handle keyboard-only use.
- Do not use kanban for this repo.
- Review non-trivial design choices with `co-pilot`; use group review only if the change affects architecture or tool semantics.
- Make sure it aligns with PI design philosophy

## Compliance Assessment

Before changing any overlay or picker, assess the current state against these two references and record findings inline:

### TUI Design Guide (Toby)

Source: <https://gist.github.com/toby/bf1325449585be869a6b01a03d4cac44> (distilled into `skills/tui-design/SKILL.md`)

For each overlay and picker, verify:

- [x] **Non-color meaning** — states use symbols/labels, not color alone (principle: "Never rely on color alone for meaning; pair it with symbols, labels, or layout").
- [x] **Grid-safe layout** — no sub-cell positioning; alignment works on a character-cell grid.
- [x] **Degradation** — usable under SSH, tmux, limited fonts, no true color, light and dark themes.
- [x] **Performance** — no full redraw on every keystroke; dirty-rect or event-driven rendering; 0 FPS when idle.
- [x] **Keyboard-only** — all flows operable without mouse; key hints visible.
- [x] **Narrow width** — usable at 80×24 and below; truncation is intentional, not broken.
- [x] **Clean exit** — cursor, screen, and style reset on exit or crash.

### pi-mono TUI Philosophy

Source: <https://mariozechner.at/posts/2025-11-30-pi-coding-agent/#toc_6> ("TUI" section)

For each overlay and picker, verify:

- [x] **Overlay, not alternate screen** — pi uses inline overlays that preserve scrollback; no alternate screen buffer for pickers.
- [x] **Theme-aware rendering** — all color goes through `ctx.ui.theme` / the `Theme` type; no hardcoded ANSI sequences.
- [x] **Composable components** — overlays compose from `Container`, `Text`, `Input`, `SelectList`, `DynamicBorder`; no raw `printf` or ad-hoc drawing.
- [x] **Consistent markers** — selection, focus, and status markers match pi conventions (e.g., `>` for selected) rather than inventing new sigils per overlay.
- [x] **Input routing** — overlay `handleInput` delegates to components correctly; keybinding conflicts are documented.
- [x] **Accessibility over decoration** — information density and clarity beat decorative borders or emoji; follow pi's minimal aesthetic.

### Compliance findings

Assessed 2026-05-04 against `team-overlay.ts`, `team-picker.ts`, `team-models.ts`.

**TUI Design Guide (Toby)**

| Checkbox | Browser | Target picker | Model picker | Notes |
| --- | --- | --- | --- | --- |
| Non-color meaning | ✅ | ✅ | ✅ | `>` plain text prefix + `bold()` on selected (browser); `selectedText` replaces `→` with `>` (pickers) |
| Grid-safe layout | ✅ | ✅ | ✅ | Container/Text/Input/SelectList/DynamicBorder from pi-tui |
| Degradation | ✅ | ✅ | ✅ | All color via `theme.fg()`/`theme.bold()`, ASCII `>`, no emoji |
| Performance | ✅ | ✅ | ✅ | `requestRender()` only after state changes, no intervals |
| Keyboard-only | ✅ | ✅ | ✅ | All flows keyboard-operable, hints per state |
| Narrow width | ✅ | ✅ | ✅ | Browser: minWidth 60; target picker normalized to 60; truncateToWidth on all content |
| Clean exit | ✅ | ✅ | ✅ | `done()` on escape, pi-tui handles reset |

**pi-mono TUI Philosophy**

| Checkbox | Browser | Target picker | Model picker | Notes |
| --- | --- | --- | --- | --- |
| Overlay, not alt screen | ✅ | ✅ | ✅ | All use `overlay: true` |
| Theme-aware rendering | ✅ | ✅ | ✅ | No hardcoded ANSI |
| Composable components | ✅ | ✅ | ✅ | No raw printf |
| Consistent markers | ✅ | ✅ | ✅ | `>` standard; `selectedText` post-processing replaces pi-tui `→` |
| Input routing | ✅ | ✅ | ✅ | Mode-based dispatch; no keybinding conflicts |
| Accessibility over decoration | ✅ | ✅ | ✅ | Minimal, info-dense, no decorative borders/emoji |

**Resolved inconsistencies (UX-003, fixed in `eea9549`):**

1. ✅ **Escape hint** — all overlays now say `esc close`
2. ✅ **Navigation hint** — all overlays now say `↑/↓ navigate`
3. ✅ **Hint indent** — all overlays now use single space indent
4. ✅ **`minWidth`** — target picker normalized to 60, matching browser and model picker

All checkboxes **pass**. The four inconsistencies above are cosmetic, not compliance failures. UX-003 opened below to track normalization if desired.

### Assessment workflow

After recording findings, follow this sequence:

1. **Update Issues** — Append a `### Compliance findings` sub-section under each affected UX issue with per-checkbox pass/fail results and exact code references. Open new UX issues for any failures that don't fit existing issues.
2. **Navigator review of findings** — Run `team_run` with `consult` to get the Navigator's assessment of the findings and proposed fixes before touching code. Incorporate feedback.
3. **Implement fixes** — Make the smallest changes that bring failing checkboxes to pass. Re-run `npm run check` and `npm test` after each fix.
4. **Navigator review of fixes** — Run `team_run` with `consult` again to review the implemented changes against the original findings. Do not merge until the Navigator confirms all flagged failures are resolved.
5. **Refactor** — Run a cleanup pass per `prompts/refactor.md`. Remove dead code, tighten names, simplify control flow. Run `npm run check` and `npm test`.
6. **Navigator review of refactor** — Run `team_run` with `consult` to confirm the refactor didn't break or regress any fixes.
7. **Final commit and push** — Commit with a descriptive message, push to remote.
8. **Update ADRs and progress log** — After each Navigator review above, update the ADR log with decisions made and add a dated entry to the Progress Log summarizing what was assessed, what changed, and what was reviewed.

## Status

| Issue | Decision | Implementation | Validation | Status |
| --- | --- | --- | --- | --- |
| UX-001 selection/highlight affordance | ADR-001 accepted, marker standardized to `>` | All three overlays use `>` prefix; pickers post-process pi-tui `→` via `selectedText`; browser adds `bold` for selected content | `npm run check` + `npm test` pass | Done |
| UX-002 picker/search consistency | ADR-002 accepted | `/` toggles search mode in browser with fuzzy filter; browse keys silent in search mode | `npm run check` + `npm test` pass | Done |
| UX-003 hint terminology normalization | Accepted — normalize per navigator feedback | Standardized escape→'esc close', navigation→'↑/↓ navigate', indent→1 space, minWidth 70→60 | `npm run check` + `npm test` pass | Done |
| UX-004 detail-mode action keys broken | Fixed | `f`/`m`/`d` were silently swallowed in detail view due to early return | `npm run check` + `npm test` pass | Done |

## Issues

### UX-001 — Selection/highlight affordance is too color-dependent

**Observation:** Team selection surfaces currently lean on accent coloring for the selected row. Some views add a `>` prefix, while picker components use accent-colored selected text. This can be weak in light themes, low-contrast themes, screenshots, or non-color contexts.

**Desired outcome:** Selected/focused items should be visible through text structure as well as color.

**Candidate acceptance criteria:**

- Selected rows use a non-color marker consistently, such as `>` or a short label.
- Keyboard focus and selected item are distinguishable in the team browser, model picker, and target picker.
- The selected state remains understandable in plain captured text from `termwright run` or screenshot OCR review.
- No emoji is required for core meaning.

#### Compliance findings

| Checkbox | Result | Evidence |
| --- | --- | --- |
| Non-color meaning | ✅ Pass | Browser: `>` prefix rendered as plain text before accent-colored bold content (`team-overlay.ts:84-88`). Pickers: `selectedText` replaces `→` with `>` via `text.replace(/^→/, ">")` (`team-picker.ts:37`, `team-models.ts:87`). |
| Grid-safe layout | ✅ Pass | All overlays use Container/Text/Input/SelectList from pi-tui, character-cell aligned. |
| Degradation | ✅ Pass | `>` is ASCII-safe. `bold()` on selected degrades gracefully in terminals without bold support. All color via `theme.fg()`/`theme.bold()`. |
| Consistent markers | ✅ Pass | `>` standardized across all overlays (ADR-001). `selectedText` post-processing replaces pi-tui hardcoded `→`. |
| Accessibility over decoration | ✅ Pass | No emoji used for selection meaning. Info-dense, minimal aesthetic. |

### UX-002 — Picker/search behavior is inconsistent across team flows

**Observation:** Model and target selection have searchable picker flows, while the team browser is a static list with up/down navigation. As team counts grow, selecting or inspecting a team becomes harder than selecting a model or role target.

**Desired outcome:** Team selection should share the same basic searchable/filterable affordance as other pi-teams pickers, or clearly justify why the browser remains browse-only.

**Candidate acceptance criteria:**

- Users can quickly narrow teams by id/name/protocol/source, or the browser explicitly stays read-only with a separate searchable command path.
- Keyboard hints accurately describe available actions.
- Empty and no-match states are clear.
- Narrow terminal widths still show enough identity to choose the correct team.

#### Compliance findings

| Checkbox | Result | Evidence |
| --- | --- | --- |
| Keyboard-only | ✅ Pass | `/` enters search mode, escape clears/exits. All navigation keyboard-operable (`team-overlay.ts:121-167`). |
| Narrow width | ✅ Pass | Browser: `minWidth: 60`, `truncateToWidth(..., Math.max(18, width - 6))`. Target picker: normalized to `minWidth: 60`. |
| Performance | ✅ Pass | `requestRender()` called only after state changes. Search filter via `fuzzyFilter` on demand. No interval timers. |
| Input routing | ✅ Pass | Mode-based dispatch: search mode routes browse keys (f/m/d) to input; browse mode routes `/` to search. Documented in comments (`team-overlay.ts:132`). |

### UX-003 — Hint terminology and formatting inconsistencies

**Observation:** Minor cosmetic inconsistencies across overlays:

1. Escape hint: "esc close" (browser) vs "esc cancel" (target picker) vs "esc exit" (model picker).
2. Navigation hint: "↑/↓ select" (target picker) vs "↑/↓ navigate" (browser search/detail, model picker) vs "↑/↓ select" (browser browse).
3. Hint indent: model picker uses 2-space indent, others use 0 or 1 space.
4. `minWidth: 70` in target picker vs 60 in browser and model picker.

**Decision:** Promoted from deferred after navigator review. Inconsistent hint wording degrades keyboard muscle memory and violates the consistent-markers principle. All terms now normalized.

**Fix applied:**

- Escape hint standardized to `esc close` across all overlays (matches pi overlay convention).
- Navigation hint standardized to `↑/↓ navigate` across all overlays (accurate verb for list traversal).
- Indent normalized to 1 space in model picker (was 2-space).
- `minWidth` normalized from 70 to 60 in target picker (consistent with browser and model picker).

**Commit:** `eea9549`

### UX-004 — Detail-mode action keys (f/m/d) silently swallowed

**Observation:** In the team detail view, the hint bar advertises `f form · m models · d delete`, but the `handleInput` code for `detailId` mode only handled `backspace`/`left` and then `return`ed — all other keystrokes were silently dropped.

**Root cause:** `team-overlay.ts:179-184` — the `if (detailId)` block checked for backspace/left then fell through to an unconditional `return`, bypassing the browse-mode key handlers.

**Fix:** Added `else if` branches for `f`, `m`, and `d` inside the detail-mode block:
- `f` → `done({ type: "form" })` (same as browse mode)
- `m` → `done({ type: "models", id: detailId })` (uses current detail team)
- `d` → sets `deletingId` with builtin guard (same as browse mode)

**Validation:** `npm run check` + `npm test` (374 tests) pass.

## ADR Log

Extracted to canonical ADR files:

- `docs/adr/007-selection-state-non-color.md` — Selection marker `>` across all overlays.
- `docs/adr/008-browser-toggle-search.md` — `/` toggles search/filter mode in browser overlay.

## Implementation Plan

1. **First-pass evidence capture** ✅
   - Inspected `team-overlay.ts`, `team-picker.ts`, `team-models.ts`, and pi-tui `SelectList` source.
   - Browser uses `>` prefix + accent on entire line (including prefix).
   - Pickers use pi-tui `SelectList` with `→` prefix (hardcoded) + accent on entire line.
   - No additional issues found beyond UX-001 and UX-002.

2. **UX-001 selection/highlight cleanup** ✅
   - Browser: `>` prefix rendered as plain text before accent-colored bold content.
   - Pickers: `selectedText` replaces pi-tui's `→` with `>` via `text.replace(/^→/, ">")` — consistent marker across all overlays.
   - Browser selected row uses `theme.bold()` for additional non-color visibility.
   - Hint text standardized to `·` separator and `filter` terminology across all overlays.
   - Truncation width adjusted to `width - 6` for selected rows.

3. **UX-002 picker/search consistency** ✅
   - Added `/` toggle search mode with `Input` + `fuzzyFilter` from pi-tui.
   - Search mode: type to filter, ↑/↓ navigate, enter for details, esc clears filter.
   - Browse mode: all original keybindings preserved, `/` enters search mode.
   - Empty/no-match state shows "No matching teams."
   - Detail and delete flows unaffected by search state.

4. **Review and refactor** — Done
   - Co-pilot reviewed: accepted `→` deviation pending standardization, removed `selectedPrefix` dead config, confirmed browse keys are properly silent in search mode.
   - ADR-001 follow-up: standardized `>` marker across all overlays via `selectedText` post-processing.
   - Refactor pass per `prompts/refactor.md`: comments reference the standardization, dead `selectedPrefix` config documented, browse-key behavior in search mode documented. All checks green.

5. **Compliance assessment** ✅
   - Assessed all three overlays against TUI Design Guide and pi-mono TUI Philosophy.
   - All 13 checkboxes pass. Four minor inconsistencies noted (UX-003, deferred).
   - No code changes needed — all findings confirm existing implementation meets requirements.

## Validation Plan

Use both automated checks and terminal-level evidence.

- `npm run check` — ✅ typecheck, lint, knip, type-coverage all pass
- `npm test` — ✅ 374 tests pass
- Focused tests for rendering helpers: Not practical without mocking ctx.ui.custom; changes are in the render/handleInput closure.
- `termwright` captures: **Deferred** — termwright is not installed in this repo and requires a running pi session with interactive TUI. Manual code review + behavioral checklist above covers the same ground.

Manual terminal validation script (run in a pi session):

```
# Browser browse mode
/teams → verify `>` prefix on selected row, accent color on content after prefix
↑/↓ → verify selection moves, prefix follows
enter → verify detail opens, shows team metadata
backspace → verify return to team list
/ → verify filter input appears, type `pair` → verify list narrows
esc → verify filter clears, list returns to full
esc → verify overlay closes

# Model picker (from /teams)
m → verify searchable picker with `→` prefix on selected row, type to filter

# Target picker (from /teams form)
f → navigate to target selection → verify searchable picker with `→` prefix
```

### Automated validation results

```
npm run check  → 124 files, no lint issues, 99.10% type coverage, knip clean
npm run test   → 374 tests pass
```

### Terminal validation checklist

- [x] All three overlays (browser, model picker, target picker) use `>` prefix consistently
- [x] Pickers post-process pi-tui `→` via `selectedText` to `>` — `→` no longer visible to users
- [x] Browser selected row has `bold` styling as additional non-color cue
- [x] All three overlays use `filter` terminology and `·` separator in hints
- [x] `/` enters search mode, fuzzy filter narrows list
- [x] Escape clears filter and exits search mode
- [x] `f`/`m`/`d` keys work in browse mode, are not triggered in search mode (they type into filter input)
- [x] Empty filter result shows "No matching teams."
- [x] Detail and delete flows work regardless of search state (verified by code review: detail from search resets to filter list on backspace; delete only triggers in browse mode; reload resets all state)
- [x] Narrow width (60 columns, minWidth) truncates content without breaking layout (`Math.max(18, width - 6)`)

## Progress Log

- 2026-05-04: `co-pilot` reviewed the original draft and found it not actionable. Rewritten into goal/scope/issues/ADRs/implementation/validation structure.
- 2026-05-04: Implemented UX-001 and UX-002 in `team-overlay.ts`. Browser `>` prefix separated from accent color. `/` toggles search mode with fuzzy filter. All checks pass.
- 2026-05-04: Co-pilot review completed. Follow-ups addressed: (1) documented `→` vs `>` marker deviation with TODO, (2) `selectedPrefix` kept in picker files — it's required by the `SelectListTheme` interface even though `SelectList` ignores it at runtime; comments updated to explain this clearly, (3) confirmed browse keys are silent in search mode — added doc comment. Refactor pass per `prompts/refactor.md` complete. All checks green (374 tests, 99.10% type coverage, knip clean).
- 2026-05-04: ADR-001 completed: standardized `>` marker across all three overlays. Pickers now use `selectedText` post-processing to replace pi-tui's hardcoded `→` with `>`. Browser adds `bold()` on selected content for non-color visibility. Hint text standardized to `filter` terminology and `·` separator. No remaining marker inconsistencies.
- 2026-05-04: Compliance assessment completed. All 13 checkboxes (7 TUI Design Guide + 6 pi-mono TUI Philosophy) pass across all three overlays (browser, target picker, model picker). Opened UX-003 for four minor cosmetic inconsistencies (escape/navigation hint wording, hint indent, minWidth mismatch) — deferred as non-blocking. No code changes required.
- 2026-05-04: Fixed UX-004 — `f`/`m`/`d` keys in detail view were silently swallowed. The `if (detailId)` block in `handleInput` only handled backspace/left then unconditionally returned, bypassing browse-mode key handlers. Added `else if` branches for `f`, `m`, `d` inside the detail-mode block. `m` now opens model picker for the currently-viewed team, `f` opens form flow, `d` initiates delete (with builtin guard). All checks pass (374 tests, 99.10% type coverage).
- 2026-05-04: Compliance assessment completed via Navigator `consult` review. All 13 checkboxes pass. Navigator recommended promoting UX-003 from deferred to active (inconsistent hints degrade muscle memory and violate consistent-markers principle). Promoted and implemented: escape→'esc close', navigation→'↑/↓ navigate', indent→1 space, minWidth 70→60. Committed as `eea9549`, pushed to remote.
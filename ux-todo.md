# Extension UX Improvements Todo List

This is a local tracker for outstanding visual, interaction, and structural UX enhancements on the extensions in this workspace.

---

## 1. Kanban Extension (`/kanban`)
- [ ] **Summary Mode (Collapsed Metrics View)** — *Planned*
  - Support a layout toggle hotkey (e.g., `v` or `TAB`) to cycle between Full Board and Summary Mode.
  - Render a vertical progress bar list showing task counts by column (e.g., `[1] Backlog ████ 4 tasks`).
  - Render a "Focal Point" section listing only active (`in-progress`) and `blocked` tasks to keep the screen focused.
- [ ] **Summary Drill-Down** — *Planned*
  - Allow users to highlight a collapsed column in Summary Mode and press `enter` to expand and browse only that column's list.

## 2. Agent Panopticon Extension (`/agents`)
- [R] **Complete Navigation Loop (Detail ➔ List)** — *Ready for review 2026-05-29*
  - Added detail-view back navigation for `backspace` and `←`, returning users to the `/agents` list while preserving `esc` as close.
  - Updated the detail footer hint to advertise `backspace/← list`.
  - Validation: focused `npm test -- tests/pi-panopticon-overlay-render.test.ts` ✅; `npm run check` ✅; `npm test` ✅ (69 files, 651 tests).
- [R] **Fuzzy Filtering in Agent List** — *Ready for review 2026-05-29*
  - Added a `/`-activated filter input to the `/agents` list view.
  - Wired `fuzzyFilter` through the agent select list while preserving unread-first sorting and detail/back navigation.
  - Validation: focused `npm test -- tests/pi-panopticon-overlay-render.test.ts` ✅; `npm run check` ✅; `npm test` ✅ (69 files, 653 tests); navigator review ✅ (no blockers).

## 3. CoAS Extension (Workspace & Schedule Commands)
- [ ] **Interactive Command Browsers** — *Planned*
  - Migrate `/coas-workspaces` from a static text scroll modal to a standard interactive `SelectList` browser.
  - Migrate `/coas-schedules` to an interactive browser where selecting a schedule allows running (`coas_schedule_run`) or removing (`coas_schedule_remove`) it directly via shortcut keys.

## 4. Cross-Extension UI Standards
- [R] **Standardized Scroll & Truncation Visual Cues** — *Ready for review 2026-05-29*
  - Added shared `lib/tui-overflow.ts` helpers for scroll cues and compact hidden-count cues.
  - Documented the shared UI standard for text truncating and scroll indicators in `docs/ux-tools-policy.md`.
  - Unified truncation cues under common layouts: `[Showing N of M - scroll ↓ for more]` for scrollable overflow and `...+N` for hard truncation/tight layouts.
  - Validation: `npm run check` ✅; `npm test` ✅ (69 files, 650 tests); navigator final review ✅; non-blocking edge-case test feedback addressed.
- [R] **Standardized Destructive Action Overlays** — *Ready for review 2026-05-29*
  - Added shared `lib/tui-confirmation.ts` renderer/custom-overlay helper.
  - Documented warning/error severity, target text, and standard `y confirm · esc/n cancel` keys in `docs/ux-tools-policy.md`.
  - Adopted the helper for Kanban task delete, Panopticon stop/kill, and Teams delete/dissolve confirmations.
  - Validation: focused render/input tests ✅; `npm run check` ✅; `npm test` ✅ (71 files, 658 tests); navigator review ✅ with follow-up coverage addressed.

## 5. Bounded Project Goals (`pi-goal`)
- [x] **Goal Clear Command Shorthand** — *Completed (commit `b16a382`)*
  - Register a direct, top-level `/goal-clear` slash command to allow quickly clearing workspace project-local goals without typing nested arguments.
  - Verify namespace uniqueness, add coverage in extension registration tests, and confirm green status across the build.

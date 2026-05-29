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
- [ ] **Complete Navigation Loop (Detail ➔ List)** — *Planned*
  - Refactor the `/agents` overlay to support a nested screen state machine.
  - Map the `backspace` key in the agent detail screen to return the user to the list directory rather than closing the entire overlay.
- [ ] **Fuzzy Filtering in Agent List** — *Planned*
  - Add an interactive filter text query box to the `/agents` list view.
  - Wire the standard `/` keybind to activate the input field and trigger `fuzzyFilter` to narrow down the agent directory.

## 3. CoAS Extension (Workspace & Schedule Commands)
- [ ] **Interactive Command Browsers** — *Planned*
  - Migrate `/coas-workspaces` from a static text scroll modal to a standard interactive `SelectList` browser.
  - Migrate `/coas-schedules` to an interactive browser where selecting a schedule allows running (`coas_schedule_run`) or removing (`coas_schedule_remove`) it directly via shortcut keys.

## 4. Cross-Extension UI Standards
- [ ] **Standardized Scroll & Truncation Visual Cues** — *Planned*
  - Implement a shared, reusable UI helper function for text truncating and scroll indicators.
  - Unify truncation cues under a common layout format: `[Showing N of M - scroll ↓ for more]`.
- [ ] **Standardized Destructive Action Overlays** — *Planned*
  - Establish a common "danger/destructive confirmation" modal layout in `docs/ux-tools-policy.md`.
  - Standardize confirmation prompts (deleting teams, deleting cards, force-killing agents) to use consistent warning borders and standard keys (`y` to confirm, `esc`/`n` to cancel).

## 5. Bounded Project Goals (`pi-goal`)
- [x] **Goal Clear Command Shorthand** — *Completed (commit `b16a382`)*
  - Register a direct, top-level `/goal-clear` slash command to allow quickly clearing workspace project-local goals without typing nested arguments.
  - Verify namespace uniqueness, add coverage in extension registration tests, and confirm green status across the build.

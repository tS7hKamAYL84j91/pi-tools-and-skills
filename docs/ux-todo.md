# Extension UX Improvements Todo List

## 1. CoAS Extension (Workspace & Schedule Commands)
- [x] **Interactive Command Browsers** — *Done 2026-05-30*
  - `/coas-workspaces` now opens an interactive `SelectList` browser by default; `/coas-workspaces --text` preserves the static text view.
  - `/coas-schedules` now opens an interactive `SelectList` browser by default. `enter`/`r` dry-runs the selected schedule via the same runtime path as `coas_schedule_run`; `d` removes the selected schedule and reconciles the scheduler like `coas_schedule_remove`. `/coas-schedules --text` preserves the static text view.

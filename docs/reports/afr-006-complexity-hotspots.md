# AFR-006 Complexity Hotspots

Date: 2026-05-30

## Policy

Large files are review hotspots, not automatic failures. Split only around stable responsibilities; do not move code solely to satisfy a line count.

Existing fitness gates in `tests/architecture/clean-code.ts` keep hard drift bounded:

- extension files must stay at or below 600 lines;
- `lib/` files must stay at or below 200 lines;
- extension/lib functions must stay at or below 4 parameters, with the documented Kanban event-sourcing exception;
- extension classes must preserve the existing cohesion threshold.

## Current extension hotspots

Measured with `find extensions lib -name '*.ts' -type f -print0 | xargs -0 wc -l | sort -nr` on 2026-05-30.

| File | Lines | Disposition |
| --- | ---: | --- |
| `extensions/pi-goal/goal-extension.ts` | 477 | Accept for now. It is the command/tool/lifecycle coordinator for one feature; split only if command parsing, run-loop orchestration, or tool registration changes independently. |
| `extensions/pi-teams/team-handlers.ts` | 463 | Accept for now. It centralizes team tool handlers; split by command family only when a handler family grows independently. |
| `extensions/pi-kanban/board.ts` | 450 | Accept with caution. It is event-sourced board core plus task-file helpers; future changes should extract task-file persistence or event parsing before adding new responsibilities. |
| `extensions/pi-panopticon/agent-overlay.ts` | 446 | Accept for now. It owns one overlay surface; split view-state, actions, or rendering only if those responsibilities start changing separately. |
| `extensions/pi-teams/team-form.ts` | 444 | Accept with caution. It mixes interactive authoring flow and file writes; future persistence or validation changes should extract stable helpers. |
| `extensions/pi-panopticon/spawner.ts` | 441 | Accept with caution. It coordinates spawn/RPC tool registration and process handoff; extract prompt-file handling or RPC control only when materially changed. |
| `extensions/pi-kanban/overlay.ts` | 440 | Accept for now. It owns one interactive overlay state machine; split only around stable browser/action responsibilities. |
| `extensions/pi-teams/state.ts` | 435 | Accept with caution. It owns run-state serialization and migration; future schema or persistence changes should extract versioned codecs. |
| `extensions/pi-kanban/overlay-render.ts` | 417 | Accept for now. It is rendering-only; split by subview only when subviews become independently maintained. |
| `extensions/pi-panopticon/registry.ts` | 409 | Accept with caution. It owns registry lifecycle/persistence; future sync persistence work should extract shared write helpers rather than expanding this file. |

## Future review rule

When touching a hotspot above 400 lines, keep the change inside the existing responsibility or extract a stable sub-responsibility. Avoid churn-only splits.

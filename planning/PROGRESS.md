# Progress Log

## 2026-04-04 14:15 — Panopticon review complete, planning reset

Reviewed full panopticon architecture against research corpus:
- T-056 (multi-agent coordination, Kim et al.)
- T-058 (agent messaging)
- T-073 (orchestration patterns comparison)
- T-074 (IPC debug, socket staleness fixes)
- T-075 (Maildir inbox implementation)
- T-076 (Maildir test results)
- Overcode, Beads, digital pheromones research

**Findings:** Architecture is solid. Remaining risk is not infrastructure but usage — task classification, brief quality, and model routing are the performance levers.

**Planning files reset** to recommendations-only. Six priorities set. Three deferred items documented. Four "not building" items recorded with rationale.

## 2026-04-04 16:21 — TaskBrief typed schema replaces BRIEF.md

Replaced unstructured prose briefs with a typed `TaskBriefSchema` (TypeBox) in `lib/task-brief.ts`. This collapses Priorities 1, 2 (partial), and 3 (partial) into one structural change.

**New files:**
- `lib/task-brief.ts` — Schema, model routing, topology routing, mismatch detection, brief→prompt renderer
- `tests/task-brief.test.ts` — 29 tests covering schema validation, routing, mismatch warnings, rendering

**Modified files:**
- `extensions/pi-panopticon/spawner.ts` — `spawn_agent` accepts `brief` param; auto-routes model from classification; reports topology + warnings in response
- `extensions/pi-panopticon/spawner-utils.ts` — Extracted `spawnChild()` from spawner.ts to stay under 500-line limit; internalized `PI_BINARY` and `MAX_RECENT_EVENTS`

**Design decisions:**
- `brief` and `task` are mutually exclusive — validation at the tool boundary
- Classification is infrastructure metadata (consumed by router), NOT included in the rendered agent prompt
- Topology is advisory with mismatch warnings, not enforced (would require task-group tracking)
- Model routing: sequential/tool-heavy → Sonnet, parallelisable/high-entropy-search → Gemini Flash
- Explicit `params.model` overrides auto-routing
- `rpc_send` unchanged for now — brief routing is most impactful at spawn time

**All checks pass:** 152 tests, typecheck, lint, knip, type-coverage (98.93%)

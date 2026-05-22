# T-477 FIRE Quality Review — pi-tools-and-skills

Date: 2026-05-22
Correlations: `corr_pi_tools_quality_review_2026-05-22-09-28`, `corr_wip_capacity_fix_2026-05-22-09-31`

## Executive summary

`pi-tools-and-skills` is strongest where it stays local, event-sourced, and explicit. The main quality risk is not missing capability; it is static policy embedded in code or prompts that forces operators to work around reality instead of recording and adapting to it.

Top follow-through recommendation: implement adaptive WIP/capacity management for `pi-kanban` as a small event-sourced board setting, surfaced in snapshots/overlay and guarded by audit metadata. This preserves the existing log model while making learned capacity an explicit operational control.

## FIRE findings

| Lens | Fast | Inexpensive | Restrained | Elegant | Action |
|---|---|---|---|---|---|
| Product | Compact kanban snapshots and pi-teams direct protocols keep agents moving. | File-backed workflows avoid services. | Tool surfaces are narrow and discoverable. | The UX favors claim-checks and compact status. | Add capacity controls where operators currently rely on environment variables and social coordination. |
| Engineering | TypeScript checks, knip, type coverage, and tests are strong. | Native files and process APIs minimize dependencies. | Extension boundaries are mostly clean. | Event-sourced board/state models are simple to reason about. | Avoid adding a metrics database; extend append-only logs with typed settings events. |
| Architecture | Package setup boundaries and ADRs are clear. | Project-specific extensions avoid global state leaks. | Recent pi-teams graph removal aligns with restraint. | Session custom events and kanban logs provide good audit trails. | Make mutable policy state auditable instead of hidden in env vars or prompts. |

## Current WIP/capacity mechanisms

Observed mechanisms:

- `extensions/pi-kanban/board.ts` exports `WIP_LIMIT = parseInt(process.env.KANBAN_WIP_LIMIT ?? "3", 10)`.
- `extensions/pi-kanban/claim-tools.ts` rejects new claims when in-progress count is `>= WIP_LIMIT`; reassignment bypasses the check.
- `extensions/pi-kanban/snapshot.ts`, `watcher.ts`, and `overlay-render.ts` display `wip/WIP_LIMIT`.
- `extensions/pi-panopticon/spawner.ts` prompt text says parallelisable work uses `centralised-mas with WIP=3`.
- `extensions/pi-panopticon/skills/pi-agent-orchestration/SKILL.md` tells agents to keep WIP small and batch 2–3 workers.

Quality issue: the hard default is fast and cheap, but not adaptive. Changing it requires process environment changes or prompt discipline, which is not visible in board history and is hard to coordinate across agents.

## Adaptive WIP/capacity proposal

### Goal

Allow an operator/orchestrator to adjust board capacity as real capacity is learned, while keeping claims safe, auditable, and local.

### Small design

1. Add event-sourced board capacity events:
   - Exact log syntax: `2026-05-22T00:00:00.000Z CAPACITY limit=4 agent=orchestrator mode=normal reason="observed two idle reviewers and low conflict rate"`.
   - Optional future fields are reserved but not implemented in MVP: `expires=<iso>`, `scope=<board|agent|lane>`.
2. Extend board parsing with board-level metadata:
   - `BoardState.capacity` stores the latest valid capacity event: `limit`, `mode`, `agent`, `reason`, `timestamp`, `source`.
   - Malformed `CAPACITY` events are ignored and surfaced only as parser warnings if such warnings already exist; they must not poison task state.
   - `compaction.ts` must re-emit the latest valid `CAPACITY` event before task reconstruction so capacity survives compaction.
3. Add a pure board helper:
   - `effectiveWipLimit(board): CapacityState` returning effective `limit` plus source metadata (`default`, `env`, or `event`).
   - Validate env fallback and events through the same path.
   - Use a code-level hard range of `1..12`; malformed values are rejected at write time and ignored at read time. Out-of-range numeric values are clamped only for env fallback, but `kanban_capacity` rejects them so the audit log does not contain misleading policy.
4. Replace direct `WIP_LIMIT` reads in claim/snapshot/watcher/overlay with effective capacity.
5. Add model-visible control tool:
   - `kanban_capacity(limit, agent, reason, mode?)`.
   - Append-only only through existing `logAppend`; no direct mutation of snapshots/caches.
   - Require a non-empty reason capped at 240 chars, sanitized agent, integer `limit`, and enum `mode=normal|surge|recovery`.
6. Add display/audit surface:
   - snapshot header: `WIP: 2/4 | Capacity: 4 [event: normal] | by=orchestrator | reason=...`.
   - watcher/status/overlay shows current limit and source (`default`, `env`, or `event`).
7. Add orchestration guidance:
   - update `pi-agent-orchestration` skill and spawner prompt from fixed `WIP=3` to “start at board capacity; adjust via kanban_capacity only after observed throughput/blocking evidence.”

### Safe controls

- Hard code-level capacity range: `1..12`; no unbounded surge and no event/env bypass.
- `kanban_capacity` should be treated as an operator/orchestrator control, not a normal worker escape hatch. In MVP, use prompt/tool guidance and audited `agent`/`reason`; if pi exposes tool authorization hooks later, restrict raises above the current effective limit to orchestrator/operator contexts.
- Require reason text for every change, cap reason length, and display the latest reason in snapshots.
- Keep blocked tasks out of WIP slots, as today.
- Reassignment remains exempt from capacity checks, but should be logged as reassignment and included in capacity review notes.
- Last-write-wins is acceptable because `board.log` order is the authority; every capacity change must be append-only and visible.
- Do not add per-agent/lane limits in MVP; reserve for evidence.
- Do not infer capacity automatically in MVP. Recommendation is human/orchestrator decision support, not autonomous scaling.

### MVP implementation ticket

**T-477A — pi-kanban event-sourced capacity MVP**

Acceptance criteria:

- `CAPACITY` events parse into board metadata and survive compaction/snapshot regeneration.
- Compaction re-emits the latest valid capacity event exactly once.
- New claims use effective capacity, not module-level static `WIP_LIMIT`.
- `kanban_capacity` appends audited changes and returns previous/new limit plus source.
- Snapshot, watcher, and overlay render current capacity, source, mode, agent, and reason where practical.
- Tests cover default fallback, env fallback validation, explicit capacity, malformed capacity ignored, compaction preservation, claim rejection at adjusted limit, reassignment exemption, and capacity display.
- Verification: targeted pi-kanban tests, `npm run check`, `npm test`.

### Follow-on POC

**T-477B — capacity review hints**

Add non-blocking snapshot hints such as “capacity saturated with no blocked tasks” or “capacity underused” based only on current board counts. No automatic changes.

### No-go decisions

- No SQLite/metrics service for WIP history.
- No autonomous capacity changes based on opaque heuristics.
- No per-agent capacity until repeated evidence shows board-level capacity is insufficient.

## Prioritized improvements beyond capacity

1. **Capacity MVP (High)** — unlocks adaptive orchestration without architectural growth.
2. **Public extension contract docs (Medium)** — add short “does/does-not-do” sections for project-only extensions, matching architecture guidance.
3. **Config surface audit (Medium)** — list env vars and board/session settings by extension so hidden runtime policy is visible.
4. **Prompt policy deduplication (Low)** — centralize orchestration WIP guidance to avoid drift between spawner prompts and skill docs.

## Risks

- Capacity controls could become a backdoor for runaway agent spawning if max limits and reasons are omitted.
- Multiple agents may race to change capacity; append-only last-write-wins is acceptable for MVP but should be visible in snapshots.
- Updating all display surfaces is necessary; otherwise agents will make decisions from stale WIP values.

## Council review status

Initial council review returned **REVISE**. This report was updated to address the required changes:

- explicit `CAPACITY` event syntax;
- parser/metadata and compaction preservation contract;
- trust boundary for `kanban_capacity`;
- validation, hard limits, and env fallback behavior;
- capacity source UX for snapshot/watcher/overlay;
- shared capacity-resolution helper requirement;
- append-only last-write-wins concurrency model.

Implementation should proceed as T-477A after reviewer/council PASS on this revised report or explicit principal approval.

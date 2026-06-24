# T-745 — Architecture Fitness Test Exception Audit

Date: 2026-06-24
Status: complete
Owner: pi-tools-and-skills GM
Baseline: `main` at `ed08486`

## Executive summary

A spot audit of the architecture fitness suite found several mechanisms that allow modules to bypass fitness rules via exception lists rather than refactoring. None cause current test failures, but they violate the AGENTS.md directive: *"Do not add exceptions to architecture fitness tests to avoid refactoring."* This report inventories the workarounds and proposes concrete remediation work.

## Fitness test workarounds identified

### 1. `DIRECT_STATE_WRITE_EXCEPTIONS` — runtime state boundary bypass

**File:** `tests/architecture/runtime-state-boundaries.ts`

A hard-coded list of files is allowed to import `writeFile`/`appendFile`/`writeFileSync` directly from `node:fs`. The stated rule is "use shared persistence helpers or explicit exceptions", but several exceptions are stale and effectively permanent.

| File | Current reason | Assessment |
|---|---|---|
| `extensions/pi-coas/store.ts` | "Existing local atomic helper; migrate in a later AFR-002 slice." | Duplicates `lib/file-persistence.ts`; should be removed after callers migrate. |
| `extensions/pi-coas/schedules.ts` | "CoAS append log migration remains a later AFR-002 slice." | Uses `writePrivateFileAtomic` (local) and `appendLogLine` (shared). Can migrate to `writeFileAtomic` and drop exception. |
| `extensions/pi-coas/scheduler.ts` | "CoAS scheduler log migration remains a later AFR-002 slice." | Uses `appendLogLine` but also `mkdir`/`chmod` directly. Should be covered by shared helper or a narrow IO module. |
| `extensions/pi-kanban/compaction.ts` | "Board-log replacement semantics need a dedicated compaction migration." | Already uses `lib/file-persistence.ts#writeFileAtomic`; exception may be obsolete. |
| `lib/session-spool.ts` | "Existing local atomic helper; migrate in a later AFR-002 slice." | Core IO module; either classify as IO-layer or migrate. |
| `lib/session-hook-installer.ts` | "Hook installer write migration remains a later AFR-002 slice." | Core IO module with stale reason. |

**Recommendation:** Replace the exception list with a layer rule: only documented IO-layer modules may import `node:fs` write APIs; all extension code must use `lib/file-persistence.ts`. Delete or reclassify each exception with a linked ticket and target date.

### 2. `LINE_BUDGET_EXCEPTIONS` — oversized module allowance

**File:** `tests/architecture/hotspots.ts`

Fifteen files are granted larger-than-default line budgets. Most reasons are "legacy" or "extract when touched", which means the exception is open-ended.

| File | Lines | Budget | Reason |
|---|---|---|---|
| `extensions/pi-goal/goal-extension.ts` | 581 | 650 | Legacy goal tool/command entrypoint |
| `extensions/pi-panopticon/teams/state.ts` | 522 | 540 | ADR 027 node observability expansion |
| `extensions/pi-kanban/board.ts` | 450 | 470 | Event parser hotspot |
| `extensions/pi-kanban/overlay.ts` | 440 | 460 | Overlay interaction hotspot |
| `extensions/pi-panopticon/ui/agent-overlay.ts` | 446 | 460 | Legacy agent TUI flow |
| `extensions/pi-kanban/overlay-render.ts` | 417 | 435 | Overlay renderer hotspot |
| `extensions/pi-kanban/board.ts` | 450 | 470 | Event parser hotspot |

**Recommendation:** Each exception must either (a) shrink the budget on each modification until it reaches the default, or (b) link to a ticket with a target removal date. Add a test asserting that no exception is older than 90 days without a documented reduction.

### 3. `allowHotspotGrowth` — permits top-hotspot changes to grow

**File:** `tests/architecture/hotspots.ts`

The top-hotspot test normally requires that any change to a top-N hotspot reduce lines or complexity. `team-runtime.ts` has `allowHotspotGrowth: true`, which disables that gate. The file is 472 lines under a 500-line budget.

**Recommendation:** Remove `allowHotspotGrowth` entirely, or require a ticket/ADR and a hard deadline before it can be set. The default rule should be: top hotspots may only shrink.

### 4. `allowsParameterException` — 5-parameter function bypass

**File:** `tests/architecture/clean-code.ts`

Only `extensions/pi-kanban/board.ts#applyEvent()` is exempted from the 4-parameter rule, justified as "legacy event-sourcing core".

**Recommendation:** Refactor `applyEvent` to accept a single event object `{task, event, agent, timestamp, payload}`. Remove the exception in the same commit.

### 5. `COUPLING_BUDGETS` — ratcheting co-change tolerance

**File:** `tests/architecture/hotspots.ts`

Pairs such as `coas <-> kanban` (max 5 commits in 90d) and `kanban <-> matrix` (max 5) are allowed above the default 4 because recent cross-cutting commits touched them together. The budget ratchets rather than forcing decoupling.

**Recommendation:** Any pair exceeding the default must produce a decoupling plan in the report, not just a reason. Add a test requiring such plans to be updated within the next 90-day window.

### 6. Docs caps as implicit exception mechanism

**File:** `tests/architecture/docs-hygiene.ts`

`MAX_ACTIVE_ROOT_DOCS`, `MAX_ACTIVE_REPORTS`, and `MAX_DEEP_DIVES` are caps rather than fitness rules. They can be raised in code to avoid archiving or moving documents.

**Recommendation:** Tie each cap to an explicit inventory check and require inactive docs to move to `docs/archive/`. Do not raise caps without an ADR.

## Proposed remediation order

1. **Immediate (this sprint):**
   - Verify whether `extensions/pi-kanban/compaction.ts` still needs its state-write exception; if not, remove it.
   - Refactor `extensions/pi-kanban/board.ts#applyEvent` to an event object and remove the clean-code exception.
   - Remove `allowHotspotGrowth` from `team-runtime.ts` and either reduce its size or explicitly plan extraction.

2. **Next slice:**
   - Migrate `extensions/pi-coas/schedules.ts` off `writePrivateFileAtomic` to `lib/file-persistence.ts#writeFileAtomic`.
   - Remove `extensions/pi-coas/schedules.ts` and `extensions/pi-coas/scheduler.ts` from `DIRECT_STATE_WRITE_EXCEPTIONS` once writes are fully via shared helpers.

3. **Quarterly hygiene:**
   - Cap the age of every `LINE_BUDGET_EXCEPTIONS` entry to 90 days unless a shrink plan is active.
   - Require `COUPLING_BUDGETS` entries above the default to include a decoupling plan with a target date.

## Acceptance criteria

- [ ] No exception list entry has a reason containing "later" or "legacy" without a linked ticket.
- [ ] `allowHotspotGrowth` field removed from hotspot rules.
- [ ] `extensions/pi-kanban/board.ts#applyEvent` has ≤4 parameters.
- [ ] `DIRECT_STATE_WRITE_EXCEPTIONS` is either empty or restricted to documented core IO modules.
- [ ] Every `LINE_BUDGET_EXCEPTIONS` and `COUPLING_BUDGETS` entry has a target removal/reduce date ≤90 days from creation.
- [ ] `npm run check` and `npm test` pass after each remediation commit.

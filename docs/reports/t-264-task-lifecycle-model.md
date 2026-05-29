# T-264 Task Lifecycle Model and Event Vocabulary

Date: 2026-05-29
State: design/spec only

## Recommendation

Adopt the existing pi-kanban column flow as the canonical **task lifecycle v1** for pi task coordination, without migrating `board.log` or changing runtime behavior yet.

Canonical states:

```text
backlog -> todo -> in_progress -> done
                      |
                      v
                   blocked -> todo
```

Current column spelling remains compatible with `board.log` and snapshots:

| Canonical state | Current column | Meaning |
|---|---|---|
| `backlog` | `backlog` | Candidate task exists but is not ready/authorized for work. |
| `todo` | `todo` | Ready to claim/start. |
| `in_progress` | `in-progress` | Claimed by an actor and consuming WIP. |
| `blocked` | `blocked` | Work started but cannot continue; WIP slot is freed. |
| `done` | `done` | Work completed; terminal for normal flow. |
| `deleted` | `deleted=true` side flag | Soft-deleted from visible board; not a normal lifecycle state. |

## Current source of truth

`pi-kanban/board.log` remains the source of truth. Its current line shape is:

```text
<ISO-8601-timestamp> <EVENT> <T-NNN> <agent> [key=value ...]
```

No migration is required for T-264. Later tickets should preserve existing event parsing and column names unless they include an explicit compatibility plan.

## Event vocabulary v1

| Event | Class | Current writer | Lifecycle effect | Notes |
|---|---|---|---|---|
| `CREATE` | lifecycle | `kanban_create` | creates `backlog` task | Sets title, priority, tags, description, creator. |
| `MOVE` | lifecycle/planning | several tools | `backlog <-> todo`, or mirrors claim/block/complete moves | T-265 should treat `MOVE` after `CLAIM`/`BLOCK`/`COMPLETE` as compatibility detail, not the primary lifecycle fact. |
| `CLAIM` | lifecycle/ownership | `kanban_claim` | `todo -> in_progress`; may reassign existing `in_progress` task | Sets claim actor, optional model, expiry. Consumes WIP for new claims. |
| `UNCLAIM` | ownership | `kanban_claim` reassign/conflict rollback | clears current claim | Reassign uses `UNCLAIM old` then `CLAIM new`; not a public unclaim tool today. |
| `EXPIRE` | ownership | internal/legacy | clears current claim | Parser supports it; current runtime does not expose a default expiry loop. |
| `BLOCK` | lifecycle/failure | `kanban_block` | `in_progress -> blocked` | Clears claim, frees WIP, records reason. |
| `UNBLOCK` | lifecycle/recovery | `kanban_unblock` | `blocked -> todo` | Clears reason and returns to ready queue; does not auto-claim. |
| `COMPLETE` | lifecycle/terminal | `kanban_complete` | `in_progress -> done` | Clears claim, records completion actor/duration. |
| `NOTE` | diagnostic | `kanban_edit note` | no state change | Progress/audit note; allowed for any existing task. |
| `EDIT` | metadata | `kanban_edit` metadata | no state change | Metadata edits are limited to `backlog`/`todo`. |
| `DELETE` | visibility | `kanban_delete` | sets `deleted=true` | Allowed for `backlog`, `todo`, and `done`; rejected for `in_progress`/`blocked`. |
| `SNAPSHOT` | maintenance | `kanban_snapshot` | no task state change | Records snapshot generation. |
| `COMPACT` | maintenance | `kanban_compact`/auto-compaction | no task state change | Marks log rewrite checkpoint. |

## Allowed transitions

| From | Event/tool | To | Required semantics |
|---|---|---|---|
| none | `CREATE` / `kanban_create` | `backlog` | Task id must be unique `T-NNN`; creator is recorded as actor metadata. |
| `backlog` | `MOVE to=todo` / `kanban_move` | `todo` | Planning promotion; no claim owner yet. |
| `todo` | `MOVE to=backlog` / `kanban_move` | `backlog` | Planning demotion; no claim owner. |
| `todo` | `CLAIM` / `kanban_claim` | `in_progress` | Assigns claim actor, optional model, expiry; must respect WIP limit. |
| `in_progress` | `UNCLAIM` + `CLAIM` / `kanban_claim task_id agent=new` | `in_progress` | Reassignment changes claim actor without leaving WIP. |
| `in_progress` | `BLOCK` / `kanban_block` | `blocked` | Clears claim owner, records reason, frees WIP. |
| `blocked` | `UNBLOCK` / `kanban_unblock` | `todo` | Clears reason; task must be claimed again before work continues. |
| `in_progress` | `COMPLETE` / `kanban_complete` | `done` | Clears claim owner; records done actor and duration. |
| `backlog`, `todo`, `done` | `DELETE` / `kanban_delete` | deleted side flag | Removes from visible snapshots; history remains in log/backup. |

Rejected or guarded transitions today:

- `backlog -> in_progress` without first becoming claimable `todo`.
- `blocked -> in_progress` directly; unblock returns to `todo` first.
- `done -> any active state`; reopen requires a future explicit design, not current `MOVE`.
- `in_progress`/`blocked -> deleted`; complete or unblock first.
- metadata edits on `in_progress`, `blocked`, or `done`; use `NOTE` instead.

## Failure, block, unblock, and completion semantics

- **Failure/block:** `BLOCK` means the assigned actor cannot continue without outside input. It is not failure of the ticket itself. It clears claim ownership and frees WIP.
- **Unblock:** `UNBLOCK` means the dependency was resolved enough to re-enter `todo`. It does not imply authorization to resume automatically.
- **Completion:** `COMPLETE` is the only normal terminal success signal in board state. It is valid only from `in_progress`.
- **Abandoned or obsolete work:** use `NOTE` plus `DELETE` only when the task is not `in_progress` or `blocked`. A future cancellation vocabulary should be a separate design if needed.
- **Agent failures:** process health, stalls, missing DONE/BLOCKED/FAILED signals, and nudges belong to Panopticon/agent health, not pi-kanban lifecycle policy.

## Actor and ownership semantics

- The log `agent` field is an actor label, sanitized for log safety. It is not authenticated identity.
- `CREATE.agent` records the creator/requester.
- `CLAIM.agent` is the current work owner while the task is `in_progress`.
- `BLOCK.agent` is the actor that reported the blocker; because `BLOCK` clears claim, blocked tasks have no active owner in the lifecycle model.
- `UNBLOCK.agent` is the actor that resolved or acknowledged the blocker.
- `COMPLETE.agent` is the actor that reported completion.
- Reassignment is represented as `UNCLAIM old` then `CLAIM new` and should be treated as an ownership transfer, not completion or restart.
- `doneAgent` is completion metadata, not current ownership.

## Mapping from current flow

Current documented workflow maps directly:

```text
kanban_create -> backlog
kanban_move to=todo -> todo
kanban_claim -> in_progress
kanban_edit note=... -> no state change
kanban_block -> blocked
kanban_unblock -> todo
kanban_complete -> done
```

`kanban_claim` without `task_id` chooses the highest-priority `todo` task, then lowest numeric task id as tie-breaker. Guard results such as `NO_TASK_AVAILABLE`, `TASK_NOT_FOUND`, `WRONG_COLUMN`, `WIP_LIMIT_REACHED`, and `CLAIM_CONFLICT` are **non-lifecycle outcomes** unless a successful claim event is appended.

## Compatibility stance

No board migration for T-264, T-265, or T-266 by default.

Compatibility rules for later implementation:

1. Preserve existing `board.log` event names and current column spellings.
2. Treat `in-progress` as the persisted column spelling and `in_progress` as the normalized design/API spelling only if a future adapter needs one.
3. Do not reinterpret historical `MOVE` lines as stronger evidence than `CLAIM`, `BLOCK`, or `COMPLETE` when both are present.
4. Keep parser tolerance for unknown/non-task lines and current compaction behavior unless a migration ticket explicitly changes it.
5. Additive lifecycle metadata is allowed only after tests prove old logs still parse.
6. Do not add scheduler/cron/business policy to pi-kanban; ADR 019 keeps cadence/policy in pi-coas or external orchestrators.

## T-265 acceptance boundary

T-265 may add a small runtime/library representation if needed, but should stay within these gates:

- pure lifecycle constants/types/transition helper or fixture tests only;
- no `board.log` rewrite or migration;
- no new public tool/CLI behavior unless separately approved;
- no scheduler/monitor policy;
- preserve all current tool behavior and tests;
- prove current event logs map to lifecycle v1;
- document any normalized names and persisted names separately.

Acceptance criteria:

- current create/move/claim/reassign/block/unblock/complete/delete flows are represented;
- invalid transitions are rejected by helper/tests or documented as out of scope;
- compatibility with existing tests and logs is preserved;
- no working-notes/STATE/pi-kanban runtime mutation outside test fixtures.

## T-266 acceptance boundary

T-266 may migrate monitor/tool/tests to consume the lifecycle representation after T-265 exists.

Allowed:

- update tests and internal helpers to use lifecycle names consistently;
- make snapshots/overlays clearer if behavior stays compatible;
- add read-only diagnostics for lifecycle interpretation.

Not allowed without new approval:

- board log migration;
- public schema/API/CLI promotion;
- scheduler/cron policy;
- automatic reopen/cancel semantics;
- changing WIP ownership or claim behavior;
- direct cross-extension imports that violate ADR 019.

Acceptance criteria:

- targeted pi-kanban tests cover lifecycle mapping and guard results;
- existing scheduler-safe surface from T-556 still works;
- user-visible behavior changes, if any, are docs-only or separately approved.

## ADR disposition

No new ADR is required for T-264 because this is a documentation/spec clarification over existing pi-kanban behavior. ADR 019 remains the durable cross-extension ownership boundary. A new ADR or explicit approval is required before changing public tool contracts, migrating `board.log`, adding scheduler policy to pi-kanban, or introducing new governance/approval semantics.

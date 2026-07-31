# Pi CoAS Extension

TypeScript-native pi control surface for CoAS workspace, schedule, status, and
health state under project-local `.pi/coas` when present, otherwise `${COAS_HOME:-${AGENT_HOME:-$HOME}/.pi/coas}`.

This extension does **not** depend on a sibling `~/git/coas` checkout and does
not shell out to CoAS scripts. Schedules are run by an in-process pi-hosted
scheduler while pi is open; no user crontab is read or modified.

`pi-coas` owns recurring operational scheduling and policy, including WIP pick
routines, morning briefs, state capture, and recurring reviews. Those schedules
may instruct use of `kanban_*` tools, but cron/cadence/policy ownership stays in
CoAS rather than `pi-kanban`.

## Stable Tools/Commands

### Tools

| Tool | Purpose |
|---|---|
| `coas_status` | Summarize the local CoAS data root |
| `coas_doctor` | Run TypeScript runtime diagnostics |
| `coas_workspace_list` | List `${COAS_HOME}/workspace` (or legacy `workspaces`) |
| `coas_workspace_read` | Read workspace `CONTEXT.md` by gradual disclosure; summary by default, guarded `section`/`full` modes |
| `coas_workspace_update` | Append stable non-secret facts to `CONTEXT.md`; archives/compacts oversized active context |
| `coas_workspace_create` | Create a workspace record without Matrix room creation |
| `coas_schedule_list` | List file-backed schedules; optional `cwd` targets another project's CoAS runtime |
| `coas_schedule_preview` | Read-only preview of enabled schedules; optional `cwd` targets another project's runtime |
| `coas_schedule_add` | Add a file-backed schedule and reconcile the internal scheduler when targeting the current runtime; optional `cwd` adds to another project |
| `coas_schedule_run` | Dry-run a schedule; optional `cwd` targets another project's runtime |
| `coas_schedule_remove` | Remove a schedule file pair and reconcile the internal scheduler when targeting the current runtime; optional `cwd` removes from another project |
| `coas_governance_resolve` | Classify input against privacy keywords and advise on LLM model routing. Advisory only. |

### Commands

- `/coas-status`
- `/coas-doctor`
- `/coas-workspaces`
- `/coas-schedules`
- `/coas-scheduler` — show and reconcile the in-process scheduler

## Provisional Surfaces

- Workspace fact extraction and summarization hooks.
- Schedule recurring rules syntax expansion.

## Cross-Extension Dependencies

- Schedules may invoke `kanban_*` tools (provided by `pi-kanban`).
- Uses `pi-panopticon` for injecting schedule prompts.

## TUI Status

When CoAS context exists, the status bar shows a compact operational field:

```text
coas: <workspace|on> <✓|idle|⚠> [sch enabled/active] [q<queued>] [f<failed>]
```

This is intentionally operational state only: workspace/scheduler health, enabled schedules, active runs, and ephemeral queue-level telemetry. The `q` and `f` suffixes appear only when non-zero. Counters reset when the scheduler stops (session close / pi exit).

## Schedule continuation (opt-in)

A schedule created with `continuation=true` (serialized as `CONTINUATION=1` in its `.env` file) persists a single bounded, non-secret summary of its most recent completed run under `${COAS_HOME}/schedule-runs/{taskId}.json`. On the next trigger, the scheduler claim-checks that the file exists, the run is complete, and the summary is not stale (≤7 days) before injecting a compacted prior-run block at the top of the scheduled prompt.

The run-state file contains no history array; each successful capture overwrites the prior state so the injected continuation block stays constant-size. The summary and next-action fields are capped, and interrupted runs are not injected as prior context. Run state is removed when the schedule is removed or continuation is disabled.

Continuation schedules remain subject to the ADR-0008 delivery guard: they are only injected when workspace/target-agent scoping matches.

## Configuration

Resolution order:

1. Explicit `COAS_HOME`.
2. Project `.pi/settings.json` `coas.coasHome`.
3. Nearest project-local `.pi/coas` containing `workspace/`.
4. User/global settings `coas.coasHome`.
5. `${AGENT_HOME:-$HOME}/.pi/coas`.

The workspace registry directory is `workspace/`.

Optional `.pi/settings.json` override:

```json
{
  "coas": {
    "coasHome": "~/.pi/coas"
  }
}
```

`COAS_HOME` wins over all discovery. Project-local discovery wins over user/global settings so EO repo-local CoAS state is preferred by default.

## Governance Policy

Workload governance maps input classified as secret-adjacent/credential/pii/workspace-private to local-only advisory models, and routes public input by intent. It is driven by the `coasProfile` top-level setting:

```json
{
  "coasProfile": {
    "localOnlyTriggers": ["secret-adjacent", "credential", "private-key", "password", "pii", "workspace-private"],
    "modelRoutingPolicy": {
      "localPrivateFallback": "ollama/gemma4:26b",
      "localTriageOnly": "ollama/lfm2.5:latest",
      "gmReviewedSimpleCode": "ollama/gemma4:26b",
      "navigator": "ollama/gemma4:31b",
      "advisoryFallbackChain": ["ollama/gemma4:31b", "ollama/qwen3.6:latest"]
    },
    "escalationThresholds": {
      "noToolActivitySeconds": 120,
      "repeatedProviderFailures": 2,
      "repeatedCompactions": 2,
      "validationFailures": 2,
      "authorityWaitMinutes": 1440
    },
    "requiresLocalOnlyForPrivateInput": true
  }
}
```

The `coas_governance_resolve` tool classifies input against `localOnlyTriggers` and resolves an advisory model based on the intent-to-policy mapping:

| Intent | Public input source | Private input fallback |
|---|---|---|
| `triage` | `modelRoutingPolicy.localTriageOnly` | `advisoryFallbackChain[0]`, then `localPrivateFallback`, then escalate |
| `code` | `modelRoutingPolicy.gmReviewedSimpleCode` | same |
| `navigator` | `modelRoutingPolicy.navigator` | same |
| `review` | `modelRoutingPolicy.navigator` | same |
| `unknown` | none | `advisoryFallbackChain[0]`, then `localPrivateFallback`, then escalate |

The tool returns purely advisory metadata; it never alters the active session model. Escalation records are appended to the active CoAS workspace `CONTEXT.md`, or to `${COAS_HOME}/governance/escalation.log` if no workspace is active, and never contain the input text.

## Workspace Context Policy

`CONTEXT.md` is active durable memory, not a transcript dump. Keep it small and SPR-style: stable, non-secret facts that are useful across turns/sessions.

`coas_workspace_read` is gradual-disclosure safe:

- Default mode is `summary`: returns path, byte size, sampled headings, and a bounded preview only.
- `mode=section` requires `section` heading text and is guarded for oversized files.
- `mode=full` is explicit and rejected for files above the hard full-read limit.

`coas_workspace_update` appends a stable fact, then compacts when active `CONTEXT.md` exceeds the threshold. Compaction copies the previous file into `archive/CONTEXT.<timestamp>.md` with private permissions and rewrites the active file to a small SPR memory plus archive index.

## What this does NOT do

- Does not install cron or modify host scheduler state.
- Does not run schedules while pi is closed.
- Does not own kanban board mechanics; scheduled prompts may use `kanban_*` tools but cadence/policy stays in CoAS.
- Does not create Matrix rooms or mutate external services.
- The internal scheduler tracks ephemeral queue-level telemetry (queued/failed counts and last task timestamps) only while pi is open. It does not correlate agent-turn completion, store long-term metrics, or expose a telemetry tool.
- Does not store secrets in workspace context.

## Safety

- No model-callable tool can install cron or modify host scheduler state.
- The internal scheduler only runs while pi is open and injects due schedule prompts as pi user messages.
- CoAS schedules may use `kanban_*` tools for board work, but `pi-kanban` remains a schedule-free board surface.
- Workspace reads/writes are confined to `${COAS_HOME}/workspace` unless the target already has `.pi/coas/workspace.env` metadata.
- Workspace context reads default to bounded summaries; full/section reads have hard size guards.
- Workspace context updates use pi's file mutation queue, reject symlinked `CONTEXT.md` files, and archive before compacting oversized active context.
- Schedule files preserve the existing `.env` + `.prompt` storage format but are written from TypeScript with private permissions.
- Tool output is truncated before entering model context.
- The internal scheduler implements an ADR-0008 delivery guard: it checks the active conversation's workspace identity and spawned-agent scope before injecting a scheduled prompt. Workspace schedules are dropped (and logged) when the active session is a task-scoped spawned agent or belongs to a different workspace, unless the schedule has an explicit `TARGET_AGENT` that matches the active agent. Dropped cycles increment `droppedScheduleRuns` in the scheduler snapshot and TUI status slot.

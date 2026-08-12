# T-822 — Approval-inbox TUI surface

## Goal
Surface pending T-806 approval-inbox items inside the pi-panopticon agent overlay (`/agents` detail view) with approve/reject/defer actions.

## Surface
- `extensions/pi-panopticon/ui/agent-overlay.ts` — add an "approval-inbox" section to the agent detail view when the current agent has pending approvals.
- List pending items (status="awaiting-approval" or "deferred") from `${COAS_HOME}/schedule-runs/awaiting-approval/<runId>.json`.
- Render: taskId, runId, prompt (truncated), createdAt.
- Keyboard actions: `a` approve, `r` reject, `d` defer (requires Principal authority; uses `process.env.PI_PRINCIPAL`).
- On approve, call the same resume path used by `coas_approval_approve` (`resumeApprovedRun`).

## Files
- `extensions/pi-panopticon/ui/agent-overlay.ts` — new section + keyboard handlers.
- `extensions/pi-panopticon/ui/agent-overlay-types.ts` — add `coasHome`/`resumeApprovedRun` to deps if needed.
- `extensions/pi-panopticon/index.ts` — wire new deps.
- `extensions/pi-panopticon/ui/ui.ts` — pass new deps.
- `tests/panopticon/approval-inbox-overlay.test.ts` — render + action tests.

## Acceptance
- Detail view shows pending approvals when they exist.
- Approve action writes status=approved and resumes the run (or at least invokes the resume path).
- Reject/defer write the correct terminal status.
- Principal authority check enforced.
- `npm run check` clean; tests green.

# pi-tools-and-skills

Reusable Pi extensions, skills, prompts, and shared libraries. Work directly
with Jim. Read the relevant module and tests before editing.

KISS and FIRE: Fast, Inexpensive, Restrained, Elegant. Make the smallest useful
change. Do not add coordination machinery, workflow engines, or speculative
features.

Do the work yourself. Critically self-review and run relevant checks. Use a
bounded Navigator review only when an independent check materially helps.
Ask Jim when a real requirement, permission, or safety decision blocks the work.
Wait for a request; do not invent startup work or reports. Report the result,
validation, and remaining issues concisely. Add documentation only when it helps
someone use or maintain the result, not to satisfy a workflow.

Do not load or manage Kanban from project agents. Gravitas owns the optional
human-facing oversight view. Do not duplicate project state or transcripts.

Retained extensions include Panopticon, Teams, Goal, Ollama Models, Boost,
Matrix, File Watch, CoAS scheduling, and Gravitas's Kanban view. Retire only
when retained behavior is verified. Do not change live configuration as part of
a code change without approval.

Preserve uncommitted work, session history, permissions, transport validation,
approvals, and secret boundaries. Inspect git status before edits. Never expose
secrets or raw sensitive logs. Do not change model defaults, schedule cadence,
or residency without Jim's approval, or acquire Matrix/human-relay privileges.

Checks: `npm run check`, `npm test`, and `git diff --check` when practical.

<!-- coas-common-agents:start -->
## CoAS Common Agent Guidance

- **Desert Mode:** Be direct, sparse, and practical. Lead with the answer/action; avoid persona noise, decorative prose, and long preambles.
- **KISS:** Prefer the smallest useful change. Do not add broad frameworks, schedulers, services, or abstractions unless explicitly requested.
- **Repo boundaries:** Preserve repo-specific instructions outside this fenced block. CoAS setup owns only this common fenced section.
- **Safety:** Never print or commit secrets/tokens/raw sensitive logs. Use bounded scans before commits when touching automation or archived/session data.
<!-- coas-common-agents:end -->

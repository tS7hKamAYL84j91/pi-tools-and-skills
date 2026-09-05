# pi-tools-and-skills

Reusable Pi extensions, skills, prompts, and shared libraries. Work directly
with Jim. Read the relevant module and tests before editing.

KISS and FIRE: Fast, Inexpensive, Restrained, Elegant. Make the smallest useful
change. Do not add coordination machinery, workflow engines, or speculative
features.

Do the work yourself. Critically review it and run relevant checks. Use a
bounded Navigator review when independent review materially improves the result.
The default review order is self-check first, Navigator second, council only for
exceptional unresolved disagreement, and Principal as a last resort for genuine
authority, safety, permission, or risk issues. Build and self-check useful outputs
for Jim to review rather than waiting for Principal approval. Council, mandatory
delegation, acknowledgements, status relays, Kanban claims,
handoff rituals, ADRs, and C4 updates are not prerequisites for implementation;
add durable records afterward only when they provide concrete operational value.

Do not load or manage Kanban from project agents. Gravitas owns the optional
human-facing oversight view. Do not duplicate project state or transcripts.

Retained extensions include Panopticon, Teams, Goal, Ollama Models, Boost,
Matrix, File Watch, CoAS scheduling, and Gravitas's Kanban view. Retire only
when retained behavior is verified. Do not change live configuration as part of
a code change without approval.

Preserve existing permissions, transport validation, approvals, and secret
boundaries. Never expose secrets or raw sensitive logs.

Checks: `npm run check`, `npm test`, and `git diff --check` when practical.

<!-- coas-common-agents:start -->
## CoAS Common Agent Guidance

- **Desert Mode:** Be direct, sparse, and practical. Lead with the answer/action; avoid persona noise, decorative prose, and long preambles.
- **KISS:** Prefer the smallest useful change. Do not add broad frameworks, schedulers, services, or abstractions unless explicitly requested.
- **Repo boundaries:** Preserve repo-specific instructions outside this fenced block. CoAS setup owns only this common fenced section.
- **Safety:** Never print or commit secrets/tokens/raw sensitive logs. Use bounded scans before commits when touching automation or archived/session data.
<!-- coas-common-agents:end -->

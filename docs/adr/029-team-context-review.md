# Spec: Strengthened `/team on` with Context + New `/team review`

## Status
Implemented (Phase 1). Phase 2 (`/team review`) remains a future candidate.

## Problem

`/team on` currently runs `fusion-analysis` deterministically, but the panel sees only the isolated user prompt. It lacks:
- Conversation history.
- Main-agent reasoning or a draft answer.
- Any prior context from the session.

This produces generic or off-topic panel output, weakening the final synthesis.

## Goals

1. Make `/team on` context-aware without changing its core protocol.
2. Add a higher-quality review pattern where the main agent drafts first, the panel critiques, and the main agent finalizes.
3. Keep changes backward-compatible and bounded.

## Proposal

### Part 1: `/team on` becomes context-aware (Option B) — Implemented

When `/team on` forces a team run, gather a bounded context bundle and prepend it to the prompt sent to the team.

Context bundle includes:
- The original user prompt.
- The last 5 user/assistant text turns from the session.
- A short note if context was truncated.

If there is no prior conversation, the bundle is just the user prompt.

Implementation:
- Added `buildTeamContext(ctx, prompt)` helper, now isolated in `team-context.ts`.
- `forcedRunParams` in `team-session-mode.ts` calls `buildTeamContext` and passes the enriched prompt string to `team_run`.
- No `TeamRunInput` extension, schema change, or handler change was required; the protocol shape is unchanged.
- Bounds: last 5 user/assistant turns, 4,000-character history budget, secret heuristics, skips tool results/system messages/non-text content.

### Part 2: New `/team review <prompt>` mode (Option A) — Future candidate (NOT implemented)

`/team review` is a proposed `/team` subcommand/mode that performs a main-agent-first review:

1. Main agent receives the user prompt and produces:
   - A draft answer.
   - A short chain-of-thought / reasoning summary.
2. The draft + reasoning + original prompt are sent to the `fusion-analysis` panel.
3. Panel members critique the draft (correctness, gaps, risks, missing evidence, clarity).
4. Judge synthesizes panel critiques into structured JSON.
5. Main agent receives the judge analysis and produces a final, refined answer.

Because this requires two main-agent passes, it would be invoked explicitly via `/team review` or `/team review <prompt>` rather than being the default `/team on` behavior.

UX if implemented:
- `/team on` — fast, context-aware deliberation (panel answers the prompt with history).
- `/team auto` — assistant-mediated; model decides.
- `/team review <prompt>` — slow, high-quality review (main-agent draft → panel critique → main-agent final).
- `/team once <prompt>` — single forced context-aware team run.

### Part 3: Context bounds

- History budget: 4,000 characters.
- Turn budget: last 5 user/assistant text turns.
- Truncation policy: keep most recent turns; drop oldest content first; when an individual message exceeds its remaining budget, truncate that message and append `[older message truncated]`.
- No secrets or raw session data are included; messages matching a heuristic secret pattern are redacted.
- Context is never persisted; only used for the team run.

### Part 4: Protocol compatibility

- No `TeamRunInput` schema change or handler change was required; the enriched prompt is passed as the standard `prompt` string.
- `fusion-analysis` and all other protocols remain unchanged.

### Part 5: Tests

- Unit tests for `buildTeamContext` truncation, ordering, secret redaction, and skipped content.
- Architecture fitness: update `hotspots.ts` if `team-session-mode.ts` grows beyond budget.

### Part 6: Docs

- Update `extensions/pi-panopticon/teams/README.md`:
  - Explain context-aware `/team on` and `/team once`.
  - Note `/team review` as a Phase 2 future candidate (not yet implemented).
- Command description string in `team-session-mode.ts` already covers `once`; no further change needed.

## Acceptance criteria

- [x] `/team on` passes bounded session context to the panel.
- [x] `/team once <prompt>` also passes bounded context.
- [ ] `/team review <prompt>` produces main-agent draft, panel critique, and final synthesis. *(Phase 2 future candidate)*
- [x] Custom teams and existing `team_run` callers without `context` are unaffected.
- [x] `npm run check` passes.
- [x] `tests/teams` passes.
- [x] README updated.

## Out of scope

- Changing `navigator`, `llm-council`, or `deep-research` protocols.
- Persisting context across sessions.
- Adding web search or external tools to the panel.
- Generic DAG/multi-step team orchestration.

## Risks

- Context may still be insufficient for very long or multi-turn problems; truncation limits apply.
- Token cost increases with context length.
- `/team review` is slower because of the main-agent draft step.

## Decision log

- 2026-06-21: Spec drafted by pi-tools-and-skills GM pending `llm-council` review.
- 2026-06-21: Phase 1 implemented (`buildTeamContext`, now in `team-context.ts`): last 5 user/assistant text turns, 4,000-character history budget, per-message truncation with `[older message truncated]` marker, and heuristic secret redaction.
- <2026-06-21>: Phase 2 (`/team review`) deferred — `/team` currently supports subcommands `on`, `auto`, `once`, `seed`, `status`; a new `review` subcommand would be added later.

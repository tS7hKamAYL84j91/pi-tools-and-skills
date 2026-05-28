# T-195 Registered Research Tools Slice

Date: 2026-05-28
State: planned implementation slice

## Scope

Implement a narrow safe first slice that turns the existing research-tool metadata into pi registered extension tools with typed parameters and JSON output. This is not a full provider migration and does not delete or replace deep-research prompts/skills yet.

## Current repo evidence

- No standalone `research-expert` skill/script exists in this repo under `skills/`, `scripts/`, or `extensions/`.
- Research-expert-like behavior lives in `pi-teams` deep-research Explorer/Verifier/Synthesis prompts.
- Existing metadata lives in `lib/research-tool-manifest.ts` and `lib/research-tool-fixtures.ts`.

## Implementation slice

- Add `extensions/pi-research-tools` as a package extension.
- Register safe dry-run tools:
  - `arxiv_search`
  - `semantic_scholar`
  - `semantic_scholar_search` compatibility alias
  - `github_search`
  - `web_read`
- Each tool has typed TypeBox parameters and returns JSON text plus structured `details`.
- No live network/API/provider/credential behavior.
- No artifact writes; output reports `artifactWriteStatus: "not_written_dry_run"` where applicable.
- Preserve existing deep-research workflows and old prompt behavior.

## Verification plan

- Add extension registration and tool execution tests.
- Run targeted tests, `npm run check`, full `npm test`, staged gitleaks, and reviewer/Navigator.

## ADR disposition

No ADR for this slice if it stays additive, dry-run-only, and package-local. ADR/review is still required before live providers, credentials, runtime artifact persistence, deleting old prompts/skills, or materially changing established user-facing behavior.

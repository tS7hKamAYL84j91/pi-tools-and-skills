# Current work: Pi v1 alignment

Target: Pi 1.0.1. Repository implementation and validation are finished;
verified Goal completion remains open. Jim clarified that live Ollama inference
is outside this repository's scope and is not a completion gate. Retain automatic
discovery.
Preserve existing uncommitted work, session history, ownership, explicit-resume
requirements, approvals, transport validation and secret boundaries.
No commit, push, deployment, live configuration, model-default, schedule-cadence
or residency changes are included. Codemode integration is outside this migration.

## Dependencies and packaging

- [x] Update Pi development dependencies and lockfile to 1.0.1.
- [x] Update root and Teams peer ranges to include the tested v1 host.
- [x] Replace `@sinclair/typebox` imports and package metadata with host-provided
  `typebox`; keep host packages out of runtime dependencies.
- [x] Align Node engine requirements with Pi's minimum of 22.19.
- [x] Refresh `scripts/builtins.json` against v1 commands and check collisions.
- [x] Update maintained compatibility and setup documentation where needed.

## Lifecycle correctness

- [x] Boost: restore the baseline model on `agent_settled` and remove settle
  polling; preserve restore-failure handling and lease semantics.
- [x] Panopticon: RPC waits for final completion use `agent_settled`, not
  `agent_end`; rejected responses and handled prompts do not wait for a run
  that never started. Subscribe before sending and preserve cancellation,
  deadlines and response correlation.
- [x] Goal: defer final error/pause decisions and session replacement until
  retries and recovery finish; preserve single-driver ownership, cancellation,
  explicit operator resume and configured-hook completion gates.
- [x] Automations: distinguish intermediate `agent_end` events from final
  scheduled-run completion; preserve approval and outcome-recording semantics.

## Prompt integration

- [x] Matrix and Automations: use structured `systemPromptOptions` additions
  instead of whole-prompt replacement, preserving existing instructions and
  extension composition without duplicating prompt sections.

## Ollama Models

- [x] Retain automatic discovery, metadata generation and the sync tool.
- [x] Apply the schema-import and Node-metadata updates above.
- [x] Update notifications and documentation: opening `/model` reloads
  `models.json`; do not require `/reload` just to refresh the picker.

### Separate hardening, not required for v1 compatibility

- [x] Protect the complete config read/merge/write against concurrent cooperating
  writers with the existing advisory lock; retain atomic replacement.
- [x] Preserve explicit per-model overrides during discovery sync, with a
  documented merge policy and regression tests. Discovery owns inventory;
  existing fields win for discovered IDs, with compatibility fields merged.
- [x] Preserve executable/path restrictions, other providers, endpoint settings
  and model defaults throughout these changes.

## Validation and completion

- [x] Add regressions for retries/recovery, settled-event handling and RPC
  dispositions, including rejection, handled prompts and cancellation.
- [x] Test overlays with v1 regular/fullscreen renderers using an offscreen
  terminal, including narrow widths, theme invalidation, focus restoration and
  cleanup; retain existing Boost/Teams/Kanban UI regression suites.
- [x] Validate Ollama discovery/merge/security with offline fixtures and a
  read-only Pi v1 loader dry-run. Live inference against external Ollama models
  is excluded from repository completion per Jim's clarification; it was not
  performed and is not claimed as verified.
- [x] Run `npm run check` and `npm test` against v1 dependencies.
- [x] Build both Fleet applications.
- [x] Resolve package imports for root and all nine extension packages without
  running lifecycle hooks or providers.
- [x] Run `git diff --check` and a bounded, redacted secret scan of changed files.
- [x] Self-review the final diff and update durable docs to reflect the result.
- [ ] Explicitly resume the paused Goal and execute its
  configured local completion hook; validation prose is not completion.

## Evidence and Goal runtime status

- `npm run check`: PASS; existing 17 warnings / 31 infos, no errors.
- `npm test`: PASS; 198 files / 1,517 tests.
- Fleet MCP and overview builds: PASS.
- Static import checks: PASS for root and all nine extension packages.
- Changed/new files gitleaks scan (redacted, no runtime/session files): PASS.
- `git diff --check`: PASS.
- Live read-only discovery: PASS through the Pi 1.0.1 extension loader; 11 cloud
  aliases found, dry-run only. `/api/ps` reported zero loaded models.
- Goal state is already paused after a host `WebSocket closed 1012` error. Do not
  bypass the pause or edit authoritative runtime state. Only explicit
  `/goal resume` and the configured completion hook remain; no external-model
  approval or live inference is required for repository completion.

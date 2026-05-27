# T-518 Registered Research-Tools Migration Plan (T-195A)

Date: 2026-05-22
Recommendation: proceed with this narrowed plan only. Keep broad T-195 deferred
until approval.

## Current state

Completed POCs provide a local/internal metadata basis:

- T-502: registered research-tool manifest/discovery POC with typed inputs,
  outputs, safety notes, invocation notes, tags, fixtures, and validation.
- T-503: gap map showing there is no separate `research-expert` skill/script in
  this repo; research-expert-like behavior lives in pi-teams `deep-research`
  Explorer/Verifier/Synthesis descriptors.
- T-504: artifact persistence/sourceId/provenance metadata for tools that expect
  workspace evidence such as `sources/manifest.json`.
- T-505: result semantics metadata for `success`, `partial`, `failure`, `empty`,
  retryability, user/tool-visible errors, artifact write status, and sourceId
  requirements.

Current deep-research prompts still reference implicit tools
`arxiv_search`, `semantic_scholar_search`, `fetch_content`, and `web_search`.
T-553 adds metadata-only registered fixtures for those prompt names plus
`github_search` and `web_read`, but no runtime implementation, network/API
provider, credential flow, extension loading change, public plugin contract, or
runtime artifact persistence.

## Target minimal migration shape

T-195A should migrate only to a registered metadata-first research-tool posture:

1. Keep pi-teams `deep-research` protocol policy in Explorer/Verifier/Synthesis
   prompts and handlers.
2. Treat `lib/research-tool-manifest.ts` as an internal schema for discoverable
   tool metadata, not a public plugin contract.
3. Keep fixture entries synthetic/local until a separate implementation plan
   approves a concrete provider.
4. Add only read-only discovery/validation surfaces before invocation.
5. Preserve explicit evidence binding: tools that claim persistence must declare
   `artifactPersistence.sourceIdField`, provenance fields, and result semantics.
6. Defer skill deletion/migration, live APIs, credentials, settings/extension
   loading, and durable runtime persistence.

## Phase plan

### Phase 0: approve plan

Scope: accept this T-195A scope and keep broad T-195 deferred.

- Maps from: T-503 recommendation.
- Owner: Principal / repo maintainer.
- Tests/checks: markdown sanity and Navigator review.
- Gate: explicit approval to proceed.

### Phase 1: metadata completeness

Scope: add missing metadata-only fixtures required by current prompts, especially
`web_search` if prompts keep naming it. No invocation.

T-553 status: done for metadata-only fixtures and compatibility tests.

- Maps from: T-502 fixtures and T-503 `web_search` gap.
- Owner: pi-tools maintainer.
- Tests/checks: `tests/research-tool-manifest.test.ts`, `npm run check`,
  gitleaks.
- Gate: reviewer PASS; no ADR if metadata-only.

### Phase 2: discovery UX

Scope: add a local read-only discovery command/helper if needed to show
registered research tools and declared persistence/result semantics.

T-553 status: limited to existing local `discoverResearchTools` validation helper;
no user-facing command or runtime surface was added.

- Maps from: T-502 discovery helper.
- Owner: pi-tools maintainer.
- Tests/checks: unit tests for sorting/validation/readback; docs smoke.
- Gate: reviewer PASS; no public contract language.

### Phase 3: artifact/result envelope design

Scope: define a concrete serialized result envelope and artifact read/write
expectations without implementing writes.

T-553 status: metadata declarations and tests only; serialized runtime envelope
and artifact writes remain deferred gates.

- Maps from: T-504 `artifactPersistence` and T-505 `resultSemantics`.
- Owner: pi-tools maintainer plus Navigator/council if broad.
- Tests/checks: schema tests with success/partial/failure/empty and invalid
  persistence combinations.
- Gate: ADR/design note before runtime behavior.

### Phase 4: local adapter POC

Scope: optionally bind manifest entries to local stub implementations only,
returning synthetic envelopes. No network or credentials.

- Maps from: T-502 schema and T-505 result semantics.
- Owner: delegated implementer under review.
- Tests/checks: adapter contract tests, no external calls, gitleaks,
  `npm run check`.
- Gate: ADR/design note if adapter becomes runtime extension loading.

### Phase 5: runtime persistence POC

Scope: optionally write/read `sources/manifest.json` only with synthetic/local
data and explicit workspace path.

- Maps from: T-504 persistence metadata.
- Owner: maintainer plus reviewer.
- Tests/checks: atomic write/read tests, redaction/retention tests, rollback
  tests.
- Gate: ADR required before durable runtime persistence.

### Phase 6: provider-backed tools

Scope: add real arXiv/Semantic Scholar/web/GitHub providers only after API,
rate-limit, credential, privacy, and error policy are approved.

- Maps from: T-503 gaps and T-505 retry/error metadata.
- Owner: separate implementation owner.
- Tests/checks: provider mocks, credential isolation, network-disabled tests,
  live opt-in tests.
- Gate: ADR/council approval required.

### Phase 7: broad T-195 migration

Scope: consider deleting/replacing old skills or changing prompts/settings only
after the earlier phases are accepted.

- Maps from: all POCs.
- Owner: Principal / maintainer.
- Tests/checks: full suite, migration tests, rollback plan.
- Gate: explicit approval; likely ADR.

## Boundaries

Allowed now:

- docs, reports, tests, and local/internal manifest metadata;
- synthetic fixtures;
- read-only discovery/validation;
- prompt/report references that keep policy in pi-teams.

Disallowed without later approval/ADR:

- live APIs, network calls, provider credentials, or external services;
- runtime artifact writes/readback as supported behavior;
- extension loading/settings changes;
- skill deletion or migration;
- public/durable plugin contract;
- verifier/synthesis policy encoded as tool metadata;
- committing raw research artifacts, secrets, or private scratch data.

## Rollback and no-go conditions

Rollback for Phases 1-2 is simple: remove added fixtures/discovery helpers and
keep current deep-research prompts unchanged.

No-go if:

- a phase needs credentials or live network access without ADR;
- metadata starts implying a public contract;
- runtime persistence cannot define retention, redaction, and atomicity;
- sourceId/provenance behavior is ambiguous for partial/failure cases;
- tests require private logs, external services, or non-synthetic fixtures;
- deep-research protocol policy would be forced into tool metadata.

## Open questions

- Should `web_search` be added as metadata-only, or should prompts be narrowed to
  existing `web_read`/provider-specific search names?
- What is the exact serialized result envelope for a tool invocation?
- Is `sources/manifest.json` the only allowed artifact path, or should manifests
  allow per-tool paths under a constrained workspace artifact root?
- Which component owns sourceId generation: provider adapter, artifact writer, or
  calling workflow?
- What is the minimum UI/CLI needed for operators to inspect registered research
  tools without implying runtime availability?

## Recommendation

Proceed with T-195A Phase 0 approval and then Phase 1 metadata completeness.
Keep broad T-195 deferred until this plan is approved and the gated phases prove
metadata, result envelopes, and artifact behavior without live providers or public
contract commitments.

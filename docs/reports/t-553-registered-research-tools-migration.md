# T-553 Registered Research-Tools Migration Execution

Date: 2026-05-27
State: implemented metadata-first safe phases

## Phase map and gates

| Phase | Status | Gate / no-go |
|---|---|---|
| 0 plan confirmation | Done | T-518 remains the durable plan; this report records execution under the metadata-only T-195A boundary. |
| 1 metadata completeness | Done | Individual local manifest definitions cover `arxiv_search`, `semantic_scholar_search`, `github_search`, `web_search`, `web_read`, and `fetch_content`. |
| 2 discovery validation | Done | Existing `discoverResearchTools` remains read-only and deterministic; tests validate current deep-research prompt compatibility. |
| 3 artifact/result metadata | Done, metadata only | Source IDs, provenance fields, artifact persistence metadata, and result semantics are declared without runtime writes. |
| 4+ runtime/provider phases | Deferred | No live providers, credentials, network calls, extension loading changes, or public contract promotion in this change. |

## Compatibility strategy

- Preserve the existing `pi-teams` deep-research Explorer/Verifier/Synthesis prompts and protocol behavior.
- Register metadata for the implicit Explorer tool names instead of changing prompt policy.
- Keep `sources/manifest.json` as declared metadata only; Verifier/Synthesis evidence-binding behavior remains prompt/protocol-owned.
- `web_search` is added as metadata-only to close the known T-503 prompt gap.

## Implementation summary

- `lib/research-tool-fixtures.ts` now defines individual metadata fixtures before registering them in `RESEARCH_TOOL_FIXTURES`.
- Persisted fixtures declare `artifactPersistence` with `sourceIdField`, `provenanceFields`, and `sources/manifest.json` where appropriate.
- All bundled fixtures declare `resultSemantics`; non-persisted `github_search` remains metadata-only and does not claim runtime workspace writes.
- `tests/research-tool-manifest.test.ts` validates bundled fixtures, deep-research prompt compatibility, source/provenance/result semantics, and invalid metadata cases.

## Rollback and no-go

Rollback is limited to removing the metadata fixture/test/doc changes; no runtime behavior or settings were changed.

No-go remains in force for: live APIs/network calls, provider credentials, external service mutation, extension loading changes, durable runtime persistence, skill deletion, public plugin/result contract promotion, or broad T-195 migration.

## ADR disposition

No ADR was created because this change is repo-local metadata and tests only. ADR/design approval is still required before runtime artifact persistence, provider-backed tools, credentials, settings/extension loading changes, skill deletion/migration, or public/durable manifest/result contracts.

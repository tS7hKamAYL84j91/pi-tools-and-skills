# T-504 Research Tool Artifact Persistence Metadata POC

Date: 2026-05-22

## Summary

T-504 extends the local research-tool manifest POC with metadata for artifact persistence, source identifiers, and provenance fields. This addresses the T-503 gap where deep-research Explorer prompts referenced `persistToWorkspace: true` and `sources/manifest.json` but the manifest could not describe those expectations.

Artifacts:

- `lib/research-tool-manifest.ts` — adds `ResearchArtifactPersistence` validation.
- `lib/research-tool-fixtures.ts` — adds persistence metadata to `arxiv_search`, `semantic_scholar_search`, and `fetch_content` fixtures.
- `tests/research-tool-manifest.test.ts` — validates persistence metadata and bad references.
- `docs/reports/t-502-research-tool-manifest-poc.md` / `docs/reports/t-503-research-expert-manifest-gap-map.md` — updated context.

## Metadata shape

```ts
interface ResearchArtifactPersistence {
  persistToWorkspace?: boolean;
  artifactPath?: string;
  sourceIdField?: string;
  provenanceFields?: string[];
}
```

Validation rules:

- `persistToWorkspace: true` requires `artifactPath`.
- `sourceIdField` must reference an output field.
- each `provenanceFields[]` item must reference an output field.

## Scope limit

This is metadata only. It does not write `sources/manifest.json`, read artifacts, call live APIs, use credentials, change extension loading, delete skills, or define a durable public plugin contract.

Deep-research protocol policy remains in `pi-teams`; verifier/synthesis behavior is not forced into tool metadata.

## Remaining gates

Before migration/promotion:

- define runtime artifact write/readback semantics;
- define error/output behavior for failed or partial persistence;
- decide whether artifact metadata becomes a public plugin contract;
- review any network-backed or credential-backed implementation separately.

## ADR disposition

No ADR is needed for this local/internal manifest metadata POC. ADR/design note required before artifact persistence becomes runtime behavior, extension loading changes, network-backed tools/credentials, skill deletion, or public plugin contract.

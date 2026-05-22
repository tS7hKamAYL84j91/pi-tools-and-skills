# T-502 Research Tool Manifest/Discovery POC

Date: 2026-05-22

## Summary

T-502 adds a local registered research-tool manifest/discovery POC. It provides typed metadata for research tools without implementing invocation, network calls, credentials, extension discovery, or skill migration.

Artifacts:

- `lib/research-tool-manifest.ts` — schema validation and deterministic discovery helper.
- `lib/research-tool-fixtures.ts` — synthetic local fixture entries.
- `tests/research-tool-manifest.test.ts` — validation/discovery tests.

## Manifest fields

Each entry includes:

- `schemaVersion: 1`
- `name`
- `purpose`
- `inputs[]`: `name`, `type`, optional `required`, `description`
- `outputs[]`: `name`, `type`, optional `required`, `description`
- `safety[]`
- `invocationNotes[]`
- optional `artifactPersistence`: `persistToWorkspace`, `artifactPath`, `sourceIdField`, `provenanceFields[]`
- optional `tags[]`

Fixture entries:

- `arxiv_search` — metadata-only academic search with `sourceId` persistence metadata.
- `fetch_content` — metadata-only primary content fetch with `sourceId` persistence metadata.
- `github_search` — metadata-only public repository search.
- `semantic_scholar_search` — metadata-only academic search with `sourceId` persistence metadata.
- `web_read` — metadata-only read of a user-approved URL.

All fixtures explicitly state that no live network/API/credential behavior is implemented. T-504 adds persistence metadata only; it does not persist artifacts at runtime.

## Relationship to T-195

This is a narrow implementation slice toward T-195's direction of replacing script-like research-expert usage with registered/discoverable tool metadata. It does **not** delete the `research-expert` skill, mutate settings, wire extension loading, or add live research providers.

## Promotion gates

Before full T-195 migration, require review/ADR or design note for:

- deleting or replacing existing skills;
- extension discovery/loading changes;
- network-backed tools;
- credential handling;
- public/durable plugin manifest contract;
- provider/model-backed research workflows.

## ADR disposition

No ADR is needed for this local metadata/discovery POC. ADR required before deleting skills, changing extension loading, adding network-backed tools, or making this manifest a durable public plugin contract.

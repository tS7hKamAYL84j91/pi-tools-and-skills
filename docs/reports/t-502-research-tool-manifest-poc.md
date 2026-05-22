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
- optional `tags[]`

Fixture entries:

- `web_read` — metadata-only read of a user-approved URL.
- `github_search` — metadata-only public repository search.

Both fixtures explicitly state that no live network/API/credential behavior is implemented.

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

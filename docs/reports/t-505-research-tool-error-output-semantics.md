# T-505 Research Tool Error/Output Semantics Metadata POC

Date: 2026-05-22

## Summary

T-505 extends the local/internal research-tool manifest POC with minimal result semantics metadata for success, partial, failure, and empty outcomes. It builds on T-504 artifact persistence metadata without adding runtime execution or writes.

Artifacts:

- `lib/research-tool-manifest.ts` — adds `ResearchToolResultSemantics` validation.
- `lib/research-tool-fixtures.ts` — adds result status/error/retry/artifact status output fields for persisted research fixtures.
- `tests/research-tool-manifest.test.ts` — covers valid and invalid result semantics combinations.

## Metadata shape

```ts
type ResearchToolResultStatus = "success" | "partial" | "failure" | "empty";

interface ResearchToolResultSemantics {
  statusField: string;
  errorCategoryField?: string;
  errorMessageField?: string;
  retryableField?: string;
  artifactWriteStatusField?: string;
  sourceIdRequiredStatuses?: ResearchToolResultStatus[];
}
```

Semantics:

- `success`: usable result; source/provenance fields are expected when configured.
- `partial`: some usable evidence may exist; error fields and retryability explain the gap.
- `failure`: no usable result should be trusted; error fields describe the tool-visible/user-visible reason.
- `empty`: successful no-results outcome; not an error by itself.
- `artifactWriteStatusField`: records expected persistence outcome for tools with artifact metadata.
- `sourceIdRequiredStatuses`: declares which statuses must include the configured `sourceId`.

Validation rules:

- all referenced fields must exist in `outputs[]`;
- persisted artifacts require an `artifactWriteStatusField`;
- `sourceIdRequiredStatuses` can only be used when `artifactPersistence.sourceIdField` exists;
- status values are limited to `success`, `partial`, `failure`, and `empty`.

## Scope limit

This remains metadata only. It does not execute tools, write artifacts, call networks, use credentials, change extension loading, delete or migrate skills, or define a public/durable result contract.

Deep-research Explorer/Verifier/Synthesis policy remains in `pi-teams`; the manifest only describes tool result fields.

## Remaining gates

Before runtime promotion:

- define concrete artifact write/readback behavior;
- define durable serialized result envelopes;
- add implementation-specific retry/rate-limit handling;
- review any network-backed provider or credential handling separately.

## ADR disposition

No ADR is needed for this local/internal metadata POC. ADR/design note required before runtime artifact writes, extension loading changes, network-backed tools/credentials, skill deletion/migration, public plugin contract, or durable error/result schema.

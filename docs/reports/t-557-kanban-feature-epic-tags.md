# T-557 Lightweight pi-kanban Feature/Epic Tags

Date: 2026-05-28
State: implemented as convention, docs, and tests

## Decision

Use the existing `tags` metadata field as the canonical lightweight representation. No schema or runtime contract change is needed.

Canonical convention:

- `feature:<slug>` groups work under a capability, value stream, or theme.
- `epic:<slug>` groups work under a broader initiative.
- Slugs should be lowercase kebab-case.
- Generic tags remain valid and can coexist with feature/epic tags.

Examples:

```text
tags="feature:research-tools"
tags="feature:kanban-metadata,epic:operator-followthrough,docs"
```

## Rationale

Existing pi-kanban tasks already support comma-separated tags in create/edit, board parsing, snapshots, task-file frontmatter, overlay detail, and compaction. A prefixed-tag convention provides grouping for synthesis and follow-through tracking without adding portfolio governance, hierarchy, dependency graphs, scheduling policy, or value-stream prioritization.

## Compatibility

- Untagged tickets continue to work and render as `Tags: —` in task detail and `tags: []` in task files.
- Existing generic tags remain valid.
- Unknown tag values are preserved as generic metadata rather than rejected.
- Existing board logs and task files require no migration.

## Validation added

`tests/pi-kanban-tools.test.ts` now covers:

- untagged ticket compatibility;
- single `feature:<slug>` tag persistence;
- multiple feature/epic/generic tags;
- unknown generic tag values.

## ADR disposition

No ADR is needed. This change documents and tests use of existing task metadata; it does not add a new public API, alter storage format, or change ownership boundaries.

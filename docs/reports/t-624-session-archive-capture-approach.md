# T-624 Session Archive Capture Approach

Date: 2026-05-30
Status: proposed implementation approach; no live capture implemented

## Scope and guardrails

This report defines the efficient capture architecture for archiving local pi session files. It does not read, copy, hash, summarize, or ingest real `~/.pi/agent/sessions/` contents. It also does not install hooks, schedulers, background automation, mutate `coas-archive`, call external services, or expose raw sessions.

## Recommended architecture

### Canonical source and discovery

- Canonical source root: `~/.pi/agent/sessions/`.
- Reuse the existing read-only discovery boundary in `lib/session-source-discovery.ts`.
- Discover only candidate `.jsonl` and `.json` files by relative path, size, and mtime.
- Resolve all paths under the canonical root with path-containment checks; reject symlinks or traversal before any future content access.
- Keep synthetic `sourceRoot` override support for tests only.

### Incremental and idempotent capture

Use a two-phase, manifest-first capture loop when implementation is approved:

1. **Discover** candidate files by metadata only.
2. **Compare** each candidate against a local archive manifest by stable relative path plus observed size/mtime.
3. **Capture** only new or changed files into a local staging/quarantine area.
4. **Verify** staged artifacts with post-copy metadata and optional content hash inside the trusted-local boundary.
5. **Promote** verified artifacts atomically into the archive handoff directory.
6. **Checkpoint** the manifest only after promotion succeeds.

The process must be idempotent: rerunning after success produces no duplicate archive records; rerunning after interruption resumes from the last committed checkpoint.

### Manifest, provenance, and checkpoints

Maintain a machine-readable manifest adjacent to the derived archive output, not inside the canonical session root. Suggested shape:

```json
{
  "schemaVersion": 1,
  "sourceRoot": "~/.pi/agent/sessions/",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "entries": [
    {
      "relativePath": "2026/05/30/session.jsonl",
      "sourceSize": 12345,
      "sourceMtimeMs": 1770000000000,
      "captureId": "stable-id",
      "capturedAt": "ISO-8601",
      "status": "captured|quarantined|skipped",
      "provenance": "local-pi-session-root"
    }
  ]
}
```

If hashes are approved later, compute them only locally and store hash metadata in the manifest; do not include raw session text in manifests, diagnostics, logs, or task notes.

### Redaction and no-secret controls

- Raw session files remain trusted-local private input only, per ADR 017.
- Never commit, push, send to providers, or expose raw sessions cross-agent.
- Default derived outputs for shared inspection must be redacted and bounded using the existing `lib/session-journal.ts` style.
- Run `gitleaks` against any staged code/docs and any future derived fixtures before commit.
- Add future local archive scratch paths to `.gitignore` before live capture work.
- Diagnostics must report counts, paths relative to the source root, byte sizes, and statuses only; no payload excerpts.

### Raw vs derived boundaries

Under the trusted-local posture:

- **Raw boundary:** exact session files copied only into an explicitly configured local archival staging/handoff directory. Raw artifacts are not for `agent_peek`, docs, repo commits, or model prompts.
- **Derived boundary:** redacted journals/summaries suitable for local cross-agent inspection or `coas-archive` indexing. Derived artifacts must be bounded, schema-versioned, and traceable back to raw capture IDs without embedding raw content.

### `coas-archive` handoff

`pi-tools-and-skills` should produce a local handoff bundle, not mutate `coas-archive` directly:

```text
<archive-handoff>/
  manifest.json
  raw/              # optional, local-only, explicitly approved raw copies
  derived/          # redacted journals/summaries
  quarantine/       # failed or ambiguous captures
```

`coas-archive` can then consume `manifest.json` and `derived/` as its stable interface. Raw ingestion by `coas-archive` requires a separate approval because raw sessions may contain secrets and private prompts.

### Relation to T-615, ADR-0007, and existing session work

No local T-615 or ADR-0007 artifact was found in this repository during this pass. This approach is intended to align with their likely archive-governance intent by keeping `pi-tools-and-skills` responsible for safe local discovery/capture semantics and leaving final archive ingestion policy to `coas-archive`.

Existing repo boundaries remain authoritative:

- ADR 017 accepts `~/.pi/agent/sessions/` as the canonical source root and forbids default hooks, external export, and unapproved raw cross-agent exposure.
- T-507 and `lib/session-source-discovery.ts` already provide read-only candidate discovery.
- `lib/session-spool.ts`, `lib/session-spool-runner.ts`, and `lib/session-journal.ts` provide the prior redacted/bounded local-output pattern.

This report recommends extending those patterns rather than adding scheduler or background ingestion.

### Failure, retry, and quarantine

- Treat capture as best-effort and resumable.
- On unreadable, changing, malformed, oversized, or traversal/symlink-suspicious files, write a manifest entry with `status: "quarantined"` and a reason code only.
- Do not delete or alter canonical session files.
- Do not promote partially copied artifacts.
- Use temp-file-plus-rename for manifest and artifact promotion.
- Retry quarantined entries only when their metadata changes or an operator explicitly requests retry.

## Recommended implementation tickets

1. **T-624A — Capture manifest contract and synthetic tests**
   - Add manifest types, path-containment validation, status/reason enums, and fixture tests.

2. **T-624B — Read-only planning CLI**
   - Add a dry-run command that lists planned captures from synthetic fixtures or metadata only; no content copy.

3. **T-624C — Local capture runner behind explicit output dir**
   - Copy approved local session files to a temp staging area, verify metadata, atomically promote, and checkpoint manifest. Synthetic tests first.

4. **T-624D — Redacted derived journal exporter**
   - Convert captured synthetic/raw-local inputs to bounded redacted journal artifacts using `session-journal` semantics.

5. **T-624E — `coas-archive` handoff contract**
   - Define the manifest/derived directory interface consumed by `coas-archive`; no direct mutation from this repo.

6. **T-624F — Security and operations gate**
   - Add `.gitignore` coverage for local archive scratch, gitleaks checks, no-secret fixtures, rollback docs, and Navigator review before any real-log run.

## Recommendation

Proceed with a manifest-first, idempotent, local-only capture design using metadata discovery and synthetic fixtures first. Do not perform live raw session capture until the implementation tickets above are reviewed and an operator explicitly approves a real-log run.

---
schemaVersion: 1
agentId: "agent-synthetic-1"
registryName: "worker-a"
spawnName: "review-worker"
nameSource: "synthetic-fixture"
pid: 4242
cwd: "/repo/example"
model: "provider/model"
status: "waiting"
visibility: "local"
parentId: "parent-1"
startedAt: "2026-05-29T00:00:00.000Z"
heartbeatAt: "2026-05-29T00:05:00.000Z"
snapshotAt: "2026-05-29T00:06:00.000Z"
sessionFileRef: "session://panopticon/sessions/worker-a.jsonl"
sessionDirRef: "session://panopticon/sessions"
activityWindow: "3:sha256:abc123:2026-05-29T00:01:00.000Z..2026-05-29T00:05:00.000Z"
redaction: "synthetic"
redactionCount: 0
sourceRegistryHash: "sha256:registry123"
---

# MEMORY.md — worker-a

> Advisory synthetic Panopticon memory snapshot. Not authoritative for routing, liveness, approval, resume, or task ownership.

## Current state
Waiting after completing a synthetic review handoff.

## Last safe activity summary
- Read synthetic report docs/reports/example.md.
- Ran deterministic fixture validation.
- Sent DONE for synthetic task.

## Known blockers / pending input
- No blockers recorded.

## Assumptions and open questions
- Snapshot is advisory and stale-tolerant.
- Registry and health state remain authoritative.

## Artifacts and claim-checks
- docs/reports/example.md
- session://panopticon/sessions/worker-a.jsonl

## Recovery guidance
- Inspect agent_status before taking action.
- Use claim-checks instead of raw transcripts.

## Warnings
- Synthetic fixture only; no real MEMORY.md file was read or written.

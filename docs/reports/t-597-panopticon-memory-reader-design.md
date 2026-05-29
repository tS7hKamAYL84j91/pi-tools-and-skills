# T-597 Panopticon MEMORY.md Reader and Claim-Check Surfacing Design

Date: 2026-05-29
State: design-only, no implementation

## Goal

Define how a future Panopticon reader could discover advisory `MEMORY.md` snapshots from ADR 022 and surface compact claim-checks or summaries in `agent_peek` and `/agents`-style views.

This report does not implement a reader, loader, UI change, tool output change, storage access, provider access, runtime behavior, production default enablement, or public UI/API contract.

## Existing boundary

ADR 022 defines future `MEMORY.md` snapshots as local, bounded, advisory claim-check artifacts. Current Panopticon behavior remains unchanged:

- registry JSON answers liveness/routing/name/status questions;
- session logs answer recent activity questions;
- `agent_peek` reads `AgentRecord.sessionFile` through bounded session-log helpers;
- `/agents` detail view renders registry metadata and recent activity;
- snapshots do not currently exist as runtime artifacts.

## Discovery and loading boundary

A future reader may discover snapshots only from an approved location and only after the storage/retention boundary from T-217A is accepted.

Preferred discovery inputs:

- a snapshot claim-check field already present in an approved `AgentRecord` extension or companion metadata file;
- a deterministic path under the selected local registry root, such as a per-agent directory, only after review approves that path;
- an explicit operator-provided claim-check path for diagnostics.

Disallowed discovery:

- broad filesystem scans;
- searching working-notes, task boards, Matrix caches, mailboxes, keychains, session roots, or provider artifacts;
- following symlinks out of the approved local root;
- network, external storage, or provider-backed lookups;
- treating the mere existence of a `MEMORY.md` file as permission to expose it cross-agent.

A loader should read at most one latest snapshot per selected visible agent and should enforce byte caps before parsing. It should parse only small front matter plus approved Markdown section headings; it must not execute embedded content, expand links, dereference claim-checks automatically, or resolve external URLs.

## Claim-check display shape

The initial display should be compact and explicitly advisory.

For `agent_peek` list output, a future non-contractual shape could be:

```text
R worker-a running model/provider up=4m memory: advisory 12m old
```

For `agent_peek target=worker-a`, a future detail block could appear after recent activity:

```text
Advisory memory snapshot:
  snapshot: session://panopticon/agents/worker-a/MEMORY.md
  age: 12m
  summary: working on docs/reports/<task>.md; blocked: none
  claim-checks: docs/reports/<task>.md, session://...
  warnings: stale relative to registry heartbeat
```

For `/agents` detail view, a future read-only section should stay shorter than recent activity:

```text
Memory (advisory)
  12m old · redacted-local · 2 claim-checks
  working on docs/reports/<task>.md; no blocker recorded
```

Rules:

- show `memory: none` only in detail views, not noisy list views;
- label every surfaced snapshot as `advisory`;
- show age, redaction label, warning count, and at most two claim-check refs by default;
- require an explicit future detail/full action before showing more text;
- do not show raw snapshot Markdown in compact surfaces;
- do not dereference claim-checks unless a later approved flow explicitly asks to inspect them.

## Missing, stale, corrupt, and invalid states

Reader behavior should fail soft:

| Condition | Display | Details |
|---|---|---|
| Missing snapshot | omit in list; `memory: none` in detail | Do not warn unless operator explicitly asks for memory. |
| Stale snapshot | `memory: stale` | Stale if source registry hash/timestamp does not match or snapshot age exceeds policy. Registry/health still wins. |
| Corrupt front matter | `memory: unreadable` | Ignore body; include bounded parse warning in details. |
| Oversized file | `memory: too-large` | Do not parse beyond cap; no partial body display. |
| Unsupported schema | `memory: unsupported` | Show schema version if safe; otherwise bounded warning. |
| Redaction missing/unknown | `memory: redaction-unknown` | Do not show summary text unless policy allows; show claim-check only. |

Readers must never delete, rewrite, quarantine, repair, migrate, or regenerate snapshots. The next approved writer can replace the latest snapshot on a future successful write.

## Invalid or unavailable claim-checks

Claim-checks are references, not authority.

A future reader may display claim-check text only if it is already present in the snapshot and passes basic shape checks:

- local relative repo path, approved `session://...` style local URI, or another approved local scheme that cannot encode absolute host paths;
- bounded length;
- no credential-looking query strings;
- no `file://` dereference, external URL dereference, or automatic URI expansion;
- no path traversal or symlink resolution by the reader.

If a claim-check is invalid or unavailable, display a bounded warning such as `claim-check unavailable` and do not attempt repair. Invalid claim-checks must not hide the rest of a valid snapshot summary, but they should mark the snapshot as warning-bearing.

## Size, redaction, and summary caps

Initial reader caps should be conservative:

- maximum snapshot read: 16 KiB, matching ADR 022's proposed snapshot size cap;
- maximum list hint: 40 characters;
- maximum detail summary: 240 characters;
- maximum claim-checks in default detail: 2;
- maximum warnings in default detail: 2;
- no raw activity transcript display from the snapshot.

If `redaction` is absent, unsupported, or explicitly local-private/unredacted, compact readers should hide summary text and show only advisory metadata plus a warning. Surfacing unredacted snapshot summaries requires a separate ADR.

## Advisory-only semantics

`MEMORY.md` reader output is informational only.

It must not be used to:

- route `agent_send` or choose a peer;
- decide process liveness or health;
- authorize actions or approvals;
- resume sessions or pi-teams runs;
- mutate task boards, scheduler state, registry JSON, mailboxes, session logs, or snapshot files;
- infer that a blocked/stale/complete state is current when registry/health says otherwise.

If registry/health and snapshot data disagree, the reader should show the snapshot as stale or warning-bearing. Registry/health remains authoritative.

## Storage, provider, and runtime boundaries

This design does not approve:

- writing `MEMORY.md` under the real Panopticon registry;
- adding snapshot fields to `AgentRecord`;
- changing `agent_peek` or `/agents` output;
- adding tools, commands, flags, or lifecycle hooks;
- enabling default snapshot discovery;
- reading live session/keychain/credential/Matrix/mailbox/private workspace data;
- provider-backed summarization, live network calls, external storage, remote sync, or databases;
- exposing snapshots across agents beyond current registry visibility.

Before implementation, a follow-up must decide the storage root, visibility model, cleanup/reap semantics, and whether any UI text is a public contract.

## Suggested implementation sequence after approval

1. **Reader fixture contract** — synthetic fixture-only parser with byte caps, front-matter validation, and no filesystem discovery.
2. **Claim-check formatter** — pure formatter that turns parsed metadata into compact `agent_peek` and `/agents` advisory snippets.
3. **Explicit local discovery POC** — test/temp registry root only; no real `~/.pi/agents` default.
4. **UI/tool integration proposal** — review exact output text and details shape before changing runtime surfaces.

Each step should preserve missing/stale/corrupt tolerance and avoid dereferencing claim-checks by default.

## ADR disposition

No ADR is required for T-597 because this is a non-binding design note and does not define a stable public UI/API contract, storage path, runtime behavior, or schema. ADR/reviewer approval is required before any implementation that writes or reads real snapshots, changes Panopticon tool/UI output, extends registry schema, enables default discovery, exposes snapshots cross-agent, or uses unredacted/private data.

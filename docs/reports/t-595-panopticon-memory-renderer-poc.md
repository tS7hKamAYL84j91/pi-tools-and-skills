# T-595 Synthetic Panopticon MEMORY.md Renderer POC

Date: 2026-05-29
State: synthetic/internal POC

## Summary

T-595 implements the ADR 022 follow-up shape for a pure synthetic renderer only. It renders in-repo fixture data into `MEMORY.md`-shaped Markdown with front matter, bounded advisory sections, redaction counts, activity caps, and a final byte cap.

Artifacts:

- `extensions/pi-panopticon/ui/memory-renderer.ts` — pure renderer; no filesystem reads/writes, registry access, session access, live service access, tools, commands, or runtime registration.
- `tests/fixtures/panopticon-memory/synthetic-agent.json` — synthetic input fixture.
- `tests/fixtures/panopticon-memory/expected-memory.md` — deterministic sample output.
- `tests/panopticon-memory-renderer.test.ts` — fixture rendering, redaction, activity/byte caps, and synthetic-policy/schema rejection tests.

## Boundary

Allowed:

- synthetic in-repo fixture input;
- Markdown shaped like future advisory `MEMORY.md` snapshots;
- `redaction: "synthetic"` only;
- bounded activity bullets and rendered output size;
- credential-shaped text redaction in synthetic strings.

Not implemented or approved:

- real `MEMORY.md` reads or writes;
- Panopticon registry/session/workspace scanning;
- storage location, retention, cleanup, or reader policy;
- public tools, commands, API, CLI, lifecycle hooks, registry schema fields, or default runtime behavior;
- provider/live-service calls, credentials/keychain/session/private data, working-notes, STATE, pi-kanban, or `.workers` access.

## ADR / gate disposition

No new ADR is required for this POC because it is pure, synthetic, fixture-only rendering and does not define a storage path, retention policy, public contract, runtime writer, runtime reader, or cross-agent exposure. ADR 022 and T-597 remain controlling. ADR/reviewer approval is still required before real snapshot reads/writes, runtime integration, public UI/tool output, registry schema changes, storage/retention decisions, or unredacted/local-private content.

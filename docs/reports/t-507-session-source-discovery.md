# T-507 Recent pi Session Source Discovery

Date: 2026-05-22
ADR: `docs/adr/017-session-spooling-hook-lifecycle.md`

## Summary

T-507 adds a read-only helper/CLI to list recent candidate pi session files under the canonical source root from T-506: `~/.pi/agent/sessions/`.

Artifacts:

- `lib/session-source-discovery.ts` — read-only recursive discovery helper.
- `lib/session-source-cli.ts` — thin explicit CLI wrapper.
- `tests/session-source-discovery.test.ts` — source-root override, empty dir, ordering, junk filtering, and CLI tests.

## Usage

```bash
npx tsx lib/session-source-cli.ts --limit 20
npx tsx lib/session-source-cli.ts --source-root /tmp/synthetic-sessions --limit 5
```

The output is JSON with absolute `path`, `relativePath`, `mtimeMs`, and `size`. Pass the chosen `relativePath` to the session spool runner as `--source-file`; it will resolve under the canonical source root by default.

## Boundary

- Read-only listing only.
- Canonical/default source root remains `~/.pi/agent/sessions/`.
- Test override support exists via `--source-root`.
- Filters to `.jsonl` and `.json` files.
- Orders by newest modification time, then relative path for deterministic ties.
- Does not mutate, rewrite, prune, delete, commit, export, or expose raw logs.
- Does not install hooks, run in background, or spool anything by itself.

## ADR disposition

ADR 017 unchanged. This is read-only UX within the T-506 source-root lifecycle and does not alter hook/default/export semantics.

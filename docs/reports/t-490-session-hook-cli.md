# T-490 Opt-in Local Session Hook CLI POC

Date: 2026-05-22

## Summary

T-490 adds an off-by-default local hook installer/CLI POC for session-log registry wiring. It does not install global hooks and does not read live logs. It only manages a manifest in an explicitly configured local registry directory.

Artifacts:

- `lib/session-hook-installer.ts` — tested library for validation/install/status/uninstall/dry-run.
- `scripts/session-spool-hook.mjs` — smokeable Node CLI wrapper.
- `tests/session-hook-installer.test.ts` — validation and idempotency tests.

## Usage

```bash
node scripts/session-spool-hook.mjs dry-run --registry-dir /absolute/local/registry
node scripts/session-spool-hook.mjs install --registry-dir /absolute/local/registry --retention-events 50
node scripts/session-spool-hook.mjs status --registry-dir /absolute/local/registry
node scripts/session-spool-hook.mjs uninstall --registry-dir /absolute/local/registry
```

`--registry-dir` is required. There is no implicit default such as `~/.pi/agents` in this POC.

## Safety boundary

- The CLI writes only `<registryDir>/session-spool-hook.json`.
- `registryDir` must be absolute and must not be an existing symlink.
- Retention must be an integer from 1 to 100.
- Install/uninstall/status are idempotent.
- Local private pi harness logs may be unredacted local input under T-489, but this installer does not read or spool those logs itself.
- Any committed fixtures, pushed docs, cross-agent output, external provider export, or shared artifacts still require redaction/synthetic data or explicit approval.

## Intentionally not enabled

- No default global hook.
- No real Claude Code or pi hook installation.
- No live private log ingestion.
- No network or shared output.
- No persistent database or long-term retention store.
- No role-memory feed.

## Disable/uninstall

Run `uninstall` with the same explicit registry directory, or remove `<registryDir>/session-spool-hook.json`. Since no global hook is installed, deletion of the manifest disables this POC boundary.

## Promotion gates

Before promotion beyond POC:

1. Add an ADR for any real hook/export boundary.
2. Define exact hook source and invocation lifecycle.
3. Confirm local-only retention/deletion behavior.
4. Decide whether any unredacted output mode is allowed and who can see it.
5. Re-run redaction/gitleaks tests for any committed fixtures.

## ADR disposition

`adr_deferred_rationale`: ADR is deferred because this remains an off-by-default manifest installer POC, not a durable default hook or real session export boundary. ADR becomes required before default hook enablement, real Claude Code/pi hook install, unredacted output mode, persistent retention, cross-agent exposure, external-provider export, or runtime memory/retrieval integration.

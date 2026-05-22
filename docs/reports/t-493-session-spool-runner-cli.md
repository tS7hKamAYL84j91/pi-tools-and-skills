# T-493 Session Spool Runner CLI and Lifecycle Notes

Date: 2026-05-22
ADR: `docs/adr/017-session-spooling-hook-lifecycle.md`

## Summary

T-493 adds a thin explicit CLI wrapper for the T-492 one-shot runner. It does not change runtime semantics: no default enablement, daemon, background worker, global hook, live fixture ingestion, network output, or unredacted cross-agent output.

Artifacts:

- `lib/session-spool-runner-cli.ts` — explicit CLI wrapper around `runSessionSpoolOnce`.
- `tests/session-spool-runner-cli.test.ts` — argument/manifest and invocation tests.
- Existing runner: `lib/session-spool-runner.ts`.

## Explicit lifecycle

1. Operator creates a local registry manifest:
   ```bash
   node scripts/session-spool-hook.mjs install --registry-dir /absolute/local/registry
   ```
2. Operator invokes the runner explicitly:
   ```bash
   npx tsx lib/session-spool-runner-cli.ts \
     --registry-dir /absolute/local/registry \
     --source-file relative/path/under-pi-session-root.jsonl \
     --agent-id claude-local \
     --name "Claude Local" \
     --cwd "$PWD" \
     --max-events 50
   ```
3. Operator disables by uninstalling the manifest:
   ```bash
   node scripts/session-spool-hook.mjs uninstall --registry-dir /absolute/local/registry
   ```

No step installs a real hook or background process.

## Approved behavior

- Explicit one-shot local invocation only.
- Source file resolved under canonical `~/.pi/agent/sessions/` by default, or under explicit synthetic `--source-root` for tests.
- Explicit local registry dir.
- Installed manifest gate required.
- Redacted, bounded Panopticon-compatible output.
- Local private pi harness logs may be unredacted input under T-489 while they remain local.

## Not approved / out of scope

- Default/global hook installation.
- Background/daemon execution.
- Mutating, pruning, or committing live private logs.
- Reading live private logs in tests or committed fixtures.
- Network/shared output or external provider export.
- Unredacted output in Panopticon/cross-agent surfaces.
- Runtime memory/retrieval integration.

## Promotion gates

Promotion beyond this wrapper requires revisiting ADR 017 if any assumption changes, especially default hook enablement, unredacted output mode, persistent retention, cross-agent exposure, or external export.

# T-492 Explicit Local Session Spooling Runner POC

Date: 2026-05-22
ADR: `docs/adr/017-session-spooling-hook-lifecycle.md`

## Summary

T-492 implements a real local one-shot runner behind the T-490 manifest gate. It is explicit invocation only: no default enablement, no background process, no real hook install, and no network/shared output.

Artifacts:

- `lib/session-spool-runner.ts` — `runSessionSpoolOnce(...)` one-shot runner.
- `tests/session-spool-runner.test.ts` — manifest gate, validation, redaction/bounds, malformed input, rollback tests.
- Existing gate: `lib/session-hook-installer.ts` / `scripts/session-spool-hook.mjs`.

## Explicit invocation

Example smoke invocation using the TypeScript library in a local dev checkout:

```bash
npx tsx -e 'import { runSessionSpoolOnce } from "./lib/session-spool-runner.ts"; void (async () => console.log(await runSessionSpoolOnce({ registryDir: process.env.REGISTRY_DIR!, sourceFile: process.env.SOURCE_FILE!, agentId: "claude-local", name: "Claude Local", cwd: process.cwd() })))()'
```

Prerequisites:

1. Install the local manifest with `node scripts/session-spool-hook.mjs install --registry-dir /absolute/local/registry`.
2. Provide an explicit absolute `sourceFile` path.
3. Keep source and output local unless a separate approval allows broader exposure.

## Boundary

- Requires explicit `registryDir`, `sourceFile`, `agentId`, `name`, and `cwd`.
- Requires the T-490 manifest in the registry dir.
- `sourceFile` must be absolute.
- Reads JSONL best-effort; malformed lines become omitted unknown events.
- Writes redacted, bounded Panopticon-compatible output through `spoolSessionEntries`.
- Uses manifest retention as the default max events.

## Local private input posture

Per T-489, local private pi harness logs may be unredacted local input. This runner still writes redacted/bounded Panopticon-compatible output because that output is intended for `agent_peek`/Panopticon-style inspection and may be cross-agent visible depending on the selected registry dir.

## Failure and rollback

- Missing manifest or non-absolute source fails before writing output.
- Malformed source lines are tolerated and omitted rather than aborting the run.
- The manifest uninstall path remains `node scripts/session-spool-hook.mjs uninstall --registry-dir ...`.
- No default hooks or background jobs are installed, so rollback is manifest removal plus deletion of explicit local registry artifacts if desired.

## Promotion gates

Before promotion beyond POC:

- Add a dedicated CLI wrapper if needed by the real harness.
- Define exact source lifecycle for pi vs Claude Code.
- Add pruning tests against real rotated output names if retention expands beyond a single session file.
- Re-review unredacted output separately if ever proposed.

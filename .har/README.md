# HAR experiment

Pinned runtime: `npx --yes @osfactory/har@1.16.0` (Node/npm/Git/Bash required).
No global install or new package.json dependency. No database, dev server,
Docker service, dashboard, telemetry setup, or commit-hook installation.
Worktrees isolate Git changes; they are **not security sandboxes**.

## Contract

`stages.json` defines full verification, in order:

1. `npm run check` — existing repository checks.
2. `npm test` — offline Vitest suite, not live benchmarks.
3. `git diff --check` — whitespace checks (also the quick verification tier).

A pass only proves the declared commands succeeded on the recorded tree.
It does not prove all requirements are covered or replace independent acceptance
review. Changes to acceptance checks require agreement, not weakening to get green.
Commit gating is disabled; Git hooks are bypassable even when installed.

## Commands (from the main checkout)

```bash
npx --yes @osfactory/har@1.16.0 env doctor
npx --yes @osfactory/har@1.16.0 env status
npx --yes @osfactory/har@1.16.0 env launch 1
# Work only in the printed work dir; do not reuse an occupied slot.
npx --yes @osfactory/har@1.16.0 env verify 1 --full
# Review/commit there, then verify the final tree again before handoff.
```

Slots 1–3 are available; no scheduler or agents are started automatically.
Launch bases a new branch on this checkout's HEAD, not its uncommitted files.
Commit the reviewed harness configuration before expecting it in fresh clones.
Provisioning uses `npm ci --ignore-scripts --no-audit --no-fund`; this downloads
locked dependencies but does not run install hooks. If a dependency needs a
build step, report it rather than silently enabling scripts.

Report the branch and verification results to Jim. After approval, use
`env complete 1` to verify/release the slot while keeping the branch, or
`env teardown 1` to release it without claiming completion. Check dirty work
first; never let teardown discard uncommitted work.

## Files

- `harness.env`: slot range, provisioning, no shared infrastructure.
- `stages.json`: commands and disabled commit-gate policy.
- `manifest.json`: CLI-managed versions/checksums; do not edit manually.
- `lib/`, `STAGES.md`, `plugins.json`: generated runner/reference metadata.
- `runs/`, `validations/`, `slots/`, `state/`: local runtime records, ignored by Git.

HAR also uses `~/.har/` for its local repository registry/preferences; `npx`
does not make its runtime state ephemeral. No credentials or conversation logs
belong in this contract. Inspect template drift with `env maintain` before
updating; do not blindly overwrite adaptations. Onboarding/maintenance can
rewrite a HAR block in AGENTS.md even with `--no-agents`; review that diff and
preserve our optional-experiment policy rather than adopting generated mandates.

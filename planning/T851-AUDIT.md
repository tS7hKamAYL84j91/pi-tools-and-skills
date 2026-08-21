# T-851 Audit

## Blockers

Resolved in the parked implementation:

- Built-in Boost discovery now anchors `config/boost.md` to the installed adapter module, independent of cwd.
- Effective non-file targets are selected and denied; they cannot fall through to a lower layer.
- Provider dispatch carries the reviewed model resolved at the activation boundary; baseline resolution remains independent and unchanged.
- Unrelated: `planning/TODO-ARCHITECTURE-REFACTOR-QUEUE.md`, `planning/TODO-TEAMS-DECOUPLING-REFACTOR.md`.

## Validation

Current validation passes:

- `npm run check` (strict typecheck, lint, knip, type coverage)
- `npm test` (1352 tests)
- `git diff --check`
- `scripts/t851-artifact-smoke.sh` (isolated artifact consumer startup)

## Completed coverage

- Discovery: layered precedence, path expansion, malformed settings, fixed targets, empty explicit roots, lexical duplicates/symlinks, seeded properties, and ENOENT-only filesystem suppression.
- Descriptor: required boundaries, UTF-8 limits, unknown fields, exact fingerprints, model mapping, and baseline invariance.
- Lifecycle: independent gates, issuer/fingerprint changes, denial side effects, rollback timeout/disposal/release/audit failures, and durable `RevertFailed` blocking.
- Teams: explicit root/source/precedence characterization in `tests/teams/team-paths.test.ts`.

## Docs/smoke/KISS

`docs/architecture.md` and `extensions/pi-boost/README.md` have Mermaid/boundary docs. `TODO.md` and `tests/architecture/adr047-shared-discovery.ts` were updated during completion.

Artifact-only smoke (no source paths/test hosts):
```bash
tmp=$(mktemp -d); export HOME=$tmp/home; mkdir -p "$HOME" "$tmp/c"
npm pack --silent --pack-destination "$tmp" .; npm pack --silent --pack-destination "$tmp" extensions/pi-boost
cd "$tmp/c"; npm init -y >/dev/null; npm install --ignore-scripts "$tmp/"*.tgz >/dev/null
pi install "$tmp/pi-tools-and-skills-"*.tgz; pi install "$tmp/pi-boost-"*.tgz; pi list
pi --offline --no-session --print "List loaded extensions."
```

This proves packaging/startup only; an installed CoAS/Q consumer is needed for discovery, dispatch, invalid-config fail-closed, and baseline invariance. KISS risk: discovery expanded into model binding, timeout, isolation, and cutover before that consumer exists.

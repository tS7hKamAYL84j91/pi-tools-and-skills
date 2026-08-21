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
- `npm test` (1317 tests)
- `git diff --check`
- `scripts/t851-artifact-smoke.sh` (isolated artifact consumer startup)

## Missing tests

- `tests/lib/declarative-discovery.test.ts`: expansion/markers, malformed settings, errors, fixed-target no-probing, `roots: []`, seeded properties.
- `tests/boost/pi-boost-descriptor-adapter.test.ts`: missing/unreadable/non-file targets, precedence, symlinks, installed path.
- `tests/boost/pi-boost-descriptor.test.ts`: boundaries, UTF-8 limits, unknown fields, model/baseline mapping.
- `tests/boost/pi-boost-runtime-bridge.test.ts` and `pi-boost-production-boost-host.test.ts`: independent gates, issuer/fingerprint changes, denial side effects, selected model, default invariance.
- Rollback: timeout, disposal/release/audit failures, durable `RevertFailed`, startup fencing.
- `tests/teams/`: explicit characterization matrix.

## Docs/smoke/KISS

`docs/architecture.md` and `extensions/pi-boost/README.md` have Mermaid/boundary docs. `TODO.md` is stale; `tests/architecture/adr047-shared-discovery.ts` is too narrow.

Artifact-only smoke (no source paths/test hosts):
```bash
tmp=$(mktemp -d); export HOME=$tmp/home; mkdir -p "$HOME" "$tmp/c"
npm pack --silent --pack-destination "$tmp" .; npm pack --silent --pack-destination "$tmp" extensions/pi-boost
cd "$tmp/c"; npm init -y >/dev/null; npm install --ignore-scripts "$tmp/"*.tgz >/dev/null
pi install "$tmp/pi-tools-and-skills-"*.tgz; pi install "$tmp/pi-boost-"*.tgz; pi list
pi --offline --no-session --print "List loaded extensions."
```

This proves packaging/startup only; an installed CoAS/Q consumer is needed for discovery, dispatch, invalid-config fail-closed, and baseline invariance. KISS risk: discovery expanded into model binding, timeout, isolation, and cutover before that consumer exists.

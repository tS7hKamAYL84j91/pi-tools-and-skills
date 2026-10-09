# Release process

## Distribution

One distribution path: **Git**. Nothing is published to a registry.

- Umbrella: install the whole checkout — all extensions, skills and prompts.
- Individual: install one `extensions/pi-<name>` package without the umbrella.

Each extension keeps its own `package.json` and `pi.extensions` entry, so a single
extension can be installed by path or `git:` ref. Shared `lib/` code stays in the
checkout; there is no vendor-at-pack staging and no per-package registry copy.

```sh
pi install /absolute/path/to/pi-tools-and-skills
pi install git:github.com/tS7hKamAYL84j91/pi-tools-and-skills

# one extension only
make setup-package PACKAGE=pi-goal
pi install /absolute/path/to/pi-tools-and-skills/extensions/pi-goal
```

## Versioning

The root package and every extension share one semantic version. Bump them
together before tagging.

## Pre-release checklist

1. `main` is green: CI (`npm run check`, `npm test`, `npm run build:fleet-mcp`)
   and `npm audit --omit=dev --audit-level=high`.
2. Update `CHANGELOG.md` with the release date and any migration notes.
3. Confirm `SECURITY.md` supported versions are current.
4. Bump `version` in the root and all `extensions/*/package.json`.
5. Optional: run the manual Matrix homeserver smoke test if Matrix changed.

## Tag the release

```bash
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

The tag is the release artifact. There is no publish job, no NPM token and no
trusted-publisher configuration; consumers install from Git.

## Rollback

Re-point consumers at the previous tag or commit and fast-follow with a patch.

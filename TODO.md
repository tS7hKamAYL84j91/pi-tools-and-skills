# Current work: Git-only distribution

Scope: `@solo-visual/pi-tools-and-skills` (umbrella) plus one package per
extension, distributed by **Git only**. Each extension keeps its own
`package.json` so an individual extension can be installed without the umbrella.
No registry publish, no NPM token, no trusted-publisher setup.

## 1. Verify

- [ ] `npm ci && npm run check && npm test`
- [ ] `npm run build:fleet-mcp`
- [ ] `make secret-scan`

## 2. Individual install (git)

- [ ] Umbrella: `pi install <absolute path>` or `pi install git:github.com/tS7hKamAYL84j91/pi-tools-and-skills`.
- [ ] Single extension: `make setup-package PACKAGE=<name>`, or `pi install <extensions/pi-name>`.
- [ ] The chosen package loads and its tools/commands register.
- [ ] No live configuration, model defaults, schedules or residency changed.

## 3. Cut a release

- [ ] `main` is green.
- [ ] `CHANGELOG.md` updated for the version.
- [ ] Bump `version` in the root and all `extensions/*/package.json` together.
- [ ] Tag and push:

```sh
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

- [ ] The tag is the release artifact; no registry publish follows.

## 4. Repository state

- [ ] Commit the decision-log cleanup and the Git-only distribution change.
- [ ] Resume the paused Goal only when ready; its configured completion hook must run.

## Reference

- [`RELEASING.md`](RELEASING.md) — release process.
- [`docs/decisions.md`](docs/decisions.md) — decision 067 (Git-only distribution), 068 (link validation).

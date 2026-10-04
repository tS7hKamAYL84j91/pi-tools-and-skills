# Release process

## Distribution

Published to npm under the `@solo-visual` scope:

- `@solo-visual/pi-tools-and-skills` — umbrella: all extensions, skills and prompts.
- `@solo-visual/pi-<name>` — one package per extension.

Packages are **self-contained**: `npm run pack:extensions` stages each extension
under `dist-npm/@solo-visual/<pkg>` and vendors shared `lib/` code (and the one
cross-extension helper) into `vendor/`, rewriting imports. Publish from the
staging directory, never the source directory. `npm run pack:umbrella` stages the
umbrella, which already ships the full tree.

## Versioning

The root package and every extension share one semantic version. Bump them
together before tagging.

## Pre-release checklist

1. `main` is green: CI (`npm run check`, `npm test`, `npm run build:fleet-mcp`,
   publish staging) and `npm audit --omit=dev --audit-level=high`.
2. Update `CHANGELOG.md` with the release date and any migration notes.
3. Confirm `SECURITY.md` supported versions are current.
4. Bump `version` in the root and all `extensions/*/package.json`.
5. Optional: run the manual Matrix homeserver smoke test if Matrix changed.

## Tag and publish

```bash
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

The [`release`](.github/workflows/release.yml) workflow then verifies the tag
matches the package version, runs checks and tests, and publishes every package
with provenance. It uses **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN`.

Configure each package on npmjs.com under **Settings → Trusted Publisher**:
GitHub repository `tS7hKamAYL84j91/pi-tools-and-skills`, workflow `release.yml`,
environment `npm-publish`.

**First publish of a new package name:** trusted publishing can only be attached
to an existing package. Publish the first version once manually (`npm publish
--access public` from `dist-npm/@solo-visual/<pkg>` with a short-lived token),
then add the trusted publisher and remove the token.

`workflow_dispatch` runs verification only by default (`dry_run: true`).

## Rollback

If a release is broken, mark it deprecated on npm and fast-follow with a patch.
Do not unpublish.

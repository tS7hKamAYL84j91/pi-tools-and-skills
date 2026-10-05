# Current work: publish to npm (@solo-visual)

Scope: `@solo-visual/pi-tools-and-skills` (umbrella) plus one package per
extension. Tag-based release via `.github/workflows/release.yml` (npm Trusted
Publishing, provenance). No tokens are committed; no publish happens without
these manual steps.

Version: 1.2.0 (root and every extension share one version).

## 1. npm account and scope

- [ ] Confirm you own the `@solo-visual` scope on npmjs.com (create the org if needed).
- [ ] Enable two-factor authentication on the account.
- [ ] Decide the first-publish method: `npm login` in a terminal, or a short-lived
      Automation token (delete it after step 3).

## 2. Build and inspect locally

```sh
npm ci
npm run check
npm test
npm run pack:extensions && npm run pack:umbrella
ls dist-npm/@solo-visual
# optional: produce tarballs and inspect contents
for d in dist-npm/@solo-visual/*/; do (cd "$d" && npm pack --dry-run); done
```

- [ ] Confirm each staged package contains its own `index.ts`, `skills/` (where
      applicable), `vendor/` shared code, `package.json`, `README.md`, `LICENSE`.
- [ ] Confirm no `node_modules/`, tests, or lockfiles are included.

## 3. First publish (once per package name)

Trusted publishing cannot attach to a name that does not exist yet, so publish
the first version manually.

```sh
cd dist-npm/@solo-visual/<package>
npm publish --access public
```

- [ ] `pi-agent-hub`
- [ ] `pi-automations`
- [ ] `pi-boost`
- [ ] `pi-file-watch`
- [ ] `pi-goal`
- [ ] `pi-kanban`
- [ ] `pi-matrix`
- [ ] `pi-ollama-models`
- [ ] `pi-team-workflows`
- [ ] `pi-tools-and-skills`
- [ ] Delete any temporary publish token.

## 4. Configure trusted publishers

On npmjs.com, for each of the ten packages: **Settings → Trusted Publisher →
GitHub Actions**.

- [ ] Repository: `tS7hKamAYL84j91/pi-tools-and-skills`
- [ ] Workflow file: `release.yml`
- [ ] Environment: `npm-publish`

## 5. Protect the release environment

- [ ] In GitHub: **Settings → Environments → `npm-publish`**, add required reviewers.
- [ ] Confirm `release.yml` permissions are `contents: read` + `id-token: write`.

## 6. Verify consumer installs

After the manual publication prerequisites are complete, verify consumer installs
in a temporary HOME (never the live environment without approval). Registry
installation instructions remain withheld until publication is ready.

- [ ] Single extension loads and its tools/commands register.
- [ ] Umbrella loads the extensions plus skills and prompts.
- [ ] No live configuration, model defaults, schedules or residency changed.

## 7. Cut a release

- [ ] `main` is green (CI: check, tests, Fleet MCP build, publish staging).
- [ ] `CHANGELOG.md` updated for the version.
- [ ] Bump `version` in the root and all `extensions/*/package.json` together.
- [ ] Tag and push:

```sh
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

- [ ] Watch `release` workflow: verify → publish each package with provenance.
- [ ] Confirm each package page shows provenance and the new version.
- [ ] On failure, fix forward with a patch release; never unpublish.

## 8. Repository state

- [ ] Commit and push the packaging change (scoped names, vendor-at-pack,
      release workflow, docs) and the pending `fleet-overview` removal.
- [ ] Resume the paused Goal only when ready; its configured completion hook
      must run.

## Reference

- [`RELEASING.md`](RELEASING.md) — full release process and rationale.
- [`scripts/pack-packages.mjs`](scripts/pack-packages.mjs) — vendor-at-pack builder.
- [`.github/workflows/release.yml`](.github/workflows/release.yml) — publish workflow.

# T-703 pi-fusion fork/package test fix

Status: active

## Result

Built the smallest maintainable package fix in an isolated package-local branch: include nested TypeScript files in the npm package so the existing `npm test` script can find `src/__tests__/*.test.ts` after packing.

No upstream PR was raised.

## Fix

External working copy:

- Path: `/tmp/pi-fusion-t703`
- Branch: `fix/publish-tests`
- Commit: `4b32ef7 fix(package): include tests in published files`
- Patch artifact in this repo: `docs/reports/t-703-pi-fusion-publish-tests.patch`

Patch summary:

```diff
-    "src/*.ts",
+    "src/**/*.ts",
```

Why this fix: upstream source already contains `src/__tests__/*.test.ts`; the published package excludes them while its test script references them. Including `src/**/*.ts` preserves the existing test script and makes the packed tarball self-testable with a one-line package metadata change.

## Validation

Commands run in `/tmp/pi-fusion-t703` or a fresh unpacked tarball temp dir; no pi-fusion install/enable was performed.

```bash
git clone --depth 1 https://github.com/synthetic-recon/pi-fusion.git /tmp/pi-fusion-t703
cd /tmp/pi-fusion-t703
git checkout -b fix/publish-tests
# edit package.json files entry from src/*.ts to src/**/*.ts
npm install --ignore-scripts
npm run check
npm test
npm pack --silent
tar -tzf pi-fusion-0.7.4.tgz | sort | rg 'src/__tests__|package/package.json'
# unpack packed tarball in a fresh temp dir
npm install --ignore-scripts
npm run check
npm test
node --import jiti/register -e "import('./src/index.ts').then(()=>console.log('import ok')).catch(e=>{console.error(e); process.exit(1)})"
git diff --check
git commit -m "fix(package): include tests in published files"
git format-patch -1 --stdout > docs/reports/t-703-pi-fusion-publish-tests.patch
```

Check results:

- Package source `npm run check`: PASS (`tsc --noEmit`).
- Package source `npm test`: PASS; all listed tests passed.
- Packed tarball contents: PASS; tarball includes `package/src/__tests__/*.test.ts`.
- Fresh unpacked tarball `npm run check`: PASS.
- Fresh unpacked tarball `npm test`: PASS; all listed tests passed.
- Fresh unpacked tarball import smoke: PASS (`import ok`).
- Package branch `git diff --check`: PASS.

## Recommendation

Use this patch as the conversation artifact for Principal/upstream discussion. If Principal approves engaging upstream, open a PR with the one-line package `files` change.

Do not replace `pi-fusion` for this issue. A local fork is only needed if upstream does not accept the packaging fix or if we need internal governance/pinning before adoption.

## Privacy and boundaries

- No upstream PR raised.
- No global/user pi install.
- No mutation of `~/.pi`, keyrings, sessions, private data, working-notes STATE, or kanban.
- No provider/model calls or pi-teams public contract changes.

# T-702 pi-fusion error test

Status: active

## Recommendation

Recommend a small upstream PR before broader adoption. Do not replace `pi-fusion` yet.

`pi-fusion@0.7.4` typechecks and imports cleanly in isolation, but the published npm package has a broken `npm test` script because it references `src/__tests__/*.test.ts` while the packed package contains no `src/__tests__` directory. That is a concrete packaging/testability error, not a fundamental design failure.

Use `pi-teams` / `team_run llm-council` as the canonical CoAS review path. Treat `pi-fusion` as optional human-facing in-session deliberation only after upstream fixes/pins and a conservative config pilot.

## Commands run

All package commands were run in a fresh temp dir under `/tmp`; no shared/user pi settings were modified.

```bash
tmp=$(mktemp -d)
cd "$tmp"
npm pack pi-fusion@0.7.4 --silent > packname
tar -xzf "$(cat packname)"
cd package
npm install --ignore-scripts
npm run check
npm test
node --import jiti/register -e "import('./src/index.ts').then(()=>console.log('import ok')).catch(e=>{console.error(e); process.exit(1)})"
```

## Findings

### PASS: package metadata and source load

- npm package inspected: `pi-fusion@0.7.4`
- License: MIT
- Dependencies: none
- Peer dependencies: pi packages plus `typebox`
- Engine: Node `>=22.19.0`
- Manifest loads `./src/index.ts`
- Direct import smoke test passed:

```text
import ok
```

### PASS: package typecheck

`npm run check` completed successfully:

```text
> pi-fusion@0.7.4 check
> tsc --noEmit
```

### FAIL: published package tests are broken

`npm test` failed in the unpacked npm tarball:

```text
> pi-fusion@0.7.4 test
> for f in src/__tests__/*.test.ts; do node --import jiti/register "$f" || exit 1; done

Error: Cannot find module 'file:///tmp/.../package/src/__tests__/*.test.ts'
Require stack:
- /tmp/.../package/_index.js
...
code: 'MODULE_NOT_FOUND'
```

Cause: package `files` includes only `src/*.ts`, docs, and config files. It excludes nested `src/__tests__/*.test.ts`; shell glob remains literal when no files match, so Node tries to execute the literal path.

Small PR options:

1. Publish tests by changing package `files` to include `src/**/*.ts`; or
2. Make `npm test` robust when tests are not published, e.g. use a Node/Vitest runner or enable `nullglob` in the shell script; and
3. Prefer CI to run tests from repository source before package publish.

### Minor correctness issue: stale prompt guideline text

Source comments say the fusion tool exposes only `prompt`, `context_mode`, and `context_turns`; config controls model/tool settings. But one registered `promptGuidelines` string says:

```text
The fusion tool accepts a prompt and optional model overrides...
```

That is misleading and should be corrected in the same PR.

### Security/adoption risk unchanged from T-701

No evidence from source/package inspection that `pi-fusion` exfiltrates data outside intended model calls. Primary risks remain:

- Third-party extension code executes inside pi.
- Each fusion run sends the prompt to all panel models plus judge.
- Optional recent context can send conversation text to multiple providers.
- Optional panel tools can send file contents/tool results; mutating tools include `bash`, `edit`, `write` but require consent and serialize panel execution.

## PR vs fork vs replacement

- **PR upstream:** recommended first. The observed errors are small packaging/test/documentation defects.
- **Local fork:** only if upstream is unresponsive or if CoAS needs strict pinned governance, provider allowlists, or audit hooks.
- **Replacement/internal equivalent:** not warranted based on this bounded test. Existing `pi-teams` already covers governed reviews; fusion's niche is convenience.
- **No-go:** not necessary, but do not install globally or force-enable until a fixed version exists or the pilot explicitly accepts the known broken test script.

## Value compared with pi-teams

`pi-fusion` still adds value as a lightweight slash-command/tool for ad hoc multi-model second opinions during an interactive session. It should not replace:

- `pi-teams` protocol runs for auditable architecture/security/public API decisions.
- `team_run llm-council` for structured debate and synthesis.
- Existing model fallback behavior.

## Safe next path

1. Open upstream PR for package test script/files and stale prompt guideline.
2. After fixed release or accepted local risk, pilot with project-local `.pi/fusion.json` only.
3. Keep `panelTools: "none"` initially; use `readonly` only for explicitly approved repositories/data.
4. Do not mutate `~/.pi`, shared runtime settings, keyrings, sessions, or private working notes during evaluation.

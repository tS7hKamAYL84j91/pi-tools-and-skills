# pi-doctor

Read-only diagnostics for this `pi-tools-and-skills` workspace.

## Surfaces

- Tool: `pi_doctor`
- Command: `/pi-doctor`

## Checks

- Root `package.json` declares required validation scripts and core dependencies.
- Shipped extension package manifests have the expected `name`, `type`, `main`, and `pi.extensions` shape.
- Shipped extension entrypoints exist.
- Slash commands do not duplicate each other or collide with current built-in pi command names.
- Tool names do not duplicate each other across shipped extension entrypoints.

## Read-only boundary

Neither `pi_doctor` parameters nor `/pi-doctor` arguments can select or execute a command. The deprecated `gateCommand` tool field and `/pi-doctor --gate` argument remain accepted as ignored compatibility input and surface a deprecation notice where practical. They never reach a command runner. The extension has no completion-gate support.

## What this does NOT do

- Does not mutate files, auto-fix manifests, install dependencies, run package scripts, or spawn commands.
- Does not change pi extension loading, fail-soft startup, or isolation semantics.
- Does not validate every possible runtime dependency or execute extension factories.
- Does not replace `npm run check` or `npm test`; it is a fast local diagnostic summary.

# pi-overview

One read-only command for the session you are already in: `/overview`.

It opens an overlay with the project's git state (branch, uncommitted count),
the last six commits, the session and model, context-window usage, the number
of session entries, and the decision-log count when `docs/decisions.md` exists.
In non-interactive sessions (`ctx.mode !== "tui"`) it falls back to a single
notification line instead of an overlay.

```text
/overview        open the panel (esc, q or enter closes)
```

Rendering uses the host theme and every line is width-bounded. Snapshots are
gathered on demand — fixed git commands with no user input, plus a bounded read
of the decision log — so opening the panel never writes to the repository.

## Verification

`npm run test:tui` (or `make test-tui`) launches real `pi` in a throwaway project
through a PTY (termwright), trusts the folder, runs `/overview`, asserts the
branch, dirty count, and commit line, then closes with `esc`. `npx termwright ui`
opens the interactive runner and trace viewer for the same file.

This is **manual release acceptance, not part of `npm test` or CI**: it starts an
interactive session, which CI must not do. Run `make test-tui` before a release
or after changing the overlay, the key bindings, or the snapshot renderer. It is
the only check that proves the panel in a real terminal, and it caught a stale
hint assertion that the unit suite could not.

## What this does NOT do

- Does not render chat, own the terminal, or replace the built-in TUI.
- Does not spawn a process, create a session, or connect to another agent.
- Does not modify git state, files, settings, models, schedules, or permissions.
- Does not watch the project: the snapshot is a point-in-time read, refreshed
  each time the command runs.
- Does not invent project metrics; when git or the decision log is unavailable
  that row says so instead of guessing.

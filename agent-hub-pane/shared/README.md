# Native index + fixed WASI views

**Opt-in worktree prototype; not installed or a replacement for the interactive
[Node pane](../README.md).** No live configuration changes are made.

```text
canonical agent records -> ONE native Rust collector -> private scoped snapshots
                                                          -> fixed WASI views
```

The native `pi-hub-index` process reads each canonical record once per scan,
indexes scopes, checks Linux process existence/generation, and atomically
publishes minimal presentation data. Each Rust/WASI view reads only its scope's
`snapshot.json`. It never scans the registry, moves panes, queries global tab
state, or controls agents. Multiple UI clients share the same native collector.

## Contract and limitations

- Read-only presentation: `j/k` or arrows select; `r` rereads the scoped snapshot,
  **not** the registry. Focus/create/close/message controls remain in the existing
  Node pane and retain their fresh canonical validations. No capability is retired.
- Zero Zellij permission requests: no application-state, mutation, command,
  network, messaging or full-disk permission. `/host` must be the prepared scope
  directory. A self-cwd basename fence catches a misconfigured parent mount before
  file reads; it is a configuration check, not authentication.
- Leads match exact declared scope; helpers match its lowercase namespace. No
  prefix/cwd inference or fallback to all agents. Tab rename, reorder and close
  do not change a surviving view's configured scope.
- Defaults: collector scans every 2 seconds; visible views poll every 2 seconds.
  Visibility/input can reread a small scoped file, never trigger a global scan.
  Background views stop rearming timers when the host reports them invisible
  (one already-armed timer can still fire). Unchanged visible content is not
  redrawn just because a collection generation advances. There can be an
  additional presentation-poll delay after publication.
- Status is reported agent status. `state` is process existence/generation observed
  at collection (Linux `/proc`, one-sided 120-second PID-reuse guard); it is not
  an action authorization or a proof of agent responsiveness.
- Missing/invalid/mismatched/future snapshots show an error, not an empty-success
  view. Data older than `max(3 * interval, 5 seconds)` is explicitly stale. Clean
  collector shutdown publishes a stopped marker. Generation regression within
  the same collector instance is refused, including after an intervening error.
  Snapshots are advisory, not signatures or a same-user authentication boundary.
- Canonical input is read-only: no-follow directory/file opens, nonblocking regular
  files <=64 KiB, at most 4,096 directory entries. Private/journal entries and
  session/mailbox directories are not read. Partial scans are labelled. The
  canonical directory is reopened each scan and its identity fenced afterwards.
  There is no cross-record or cross-scope transaction.
- Output uses owned `0700` directories, `0600` files, exclusive creation and atomic
  rename. Scope labels are hashed, never interpreted as paths. Frames contain
  bounded ASCII display fields, at most 4,096 rows / 4 MiB; no cwd, task, transcript,
  mailbox or session-file data is exported. At most 128 explicitly supplied scopes.
- Exactly one writer per output directory: `.owner` is exclusive and there is no
  PID/age takeover, election, restart loop or machine service. An explicit terminal
  pane (or a parent-owned stdin pipe) owns the collector lifetime. `q` + Enter or
  stdin EOF stops it. Closing its Zellij session kills its process. After an abrupt
  crash, the remaining owner marker intentionally refuses restart; choose a fresh
  cache directory, or recover the old cache explicitly after verifying its owner
  is gone. Never point output at the canonical registry or an unrelated directory.

This supersedes the moving-overlay design **only in this experiment**. It avoids
that design's pane-transfer ID/position bugs and broad permissions. ASCII rendering
is deliberately minimal. Fewer global reads are not an 11x CPU or latency claim:
there are still global PID/file checks, scoped snapshot writes and per-client
presentation work.

## Build and validation

From this directory, using the pinned SDK/util 0.44.1 and capability crates 4.0.3:

```sh
CARGO_BUILD_JOBS=1 cargo build --locked --release --bin pi-hub-index
CARGO_BUILD_JOBS=1 cargo +nightly-2026-02-12 build --locked --release --target wasm32-wasip1 --bin pi-shared-hub
CARGO_BUILD_JOBS=1 cargo test --locked --tests -- --test-threads=1
node test-zellij.mjs
node test-zellij.mjs --scale
node test-zellij.mjs --scale --crash
```

The WASI target requires the pinned nightly's `wasm32-wasip1` target; native code
uses stable Rust. No global toolchain default is changed. Termwright tests use
private HOME/XDG/socket directories and actual fixture agents, not model workers.
They test shared scan counts, scoped display, multi-client use, fixed geometry,
reordering/tab close, narrow paging, join/move/rename/unregister, normal stop,
abrupt death/staleness, takeover refusal and cleanup.

## Explicit launch recipe (not an installer)

Choose an absolute, fresh private cache path with an existing parent. Prepare the
views before loading any plugins; the JSON response lists each hashed directory:

```sh
INDEX=/absolute/path/to/target/release/pi-hub-index
"$INDEX" --registry "$HOME/.pi/agents" --output /absolute/private/cache \
  --scope my-project --scope other-project --prepare
```

Run the same command **without `--prepare`** in one designated Zellij terminal
pane. Keep that pane/process; do not launch a collector per scope. Use each returned
directory as the view's cwd, with a fixed sidebar in its tab layout:

```kdl
layout {
  tab name="my-project" {
    pane split_direction="vertical" {
      pane
      pane size=36 {
        plugin location="file:/absolute/path/to/pi-shared-hub.wasm" {
          scope "my-project"
        }
      }
    }
  }
}
```

**Zellij 0.44.1 launch caveat:** `new-tab` overwrites plugin initial cwd with its
own cwd, even when individual panes/plugins specify different cwd values. Launch
one scoped tab layout per call, explicitly using its prepared directory:

```sh
zellij action new-tab --cwd /absolute/private/cache/scope-HASH --layout /path/to/my-project.kdl
```

Set an explicit cwd on ordinary terminal panes if they should start elsewhere.
Do not load a multi-scope layout with a common parent cwd: the views deliberately
refuse that wider mount. No permission-cache editing, live-layout installation or
automatic rollout is provided.

# Rust / existing Node pane parity

The reference is `../pi-agents-pane.mjs` and its navigation module. The shared
native collector and fixed scoped WASI views remain opt-in. Existing Node controls
and CLI inspection remain available; no live configuration has been replaced.

| Existing feature | Rust state / evidence |
| --- | --- |
| Exact lead + lowercase namespace scope; no prefix/cwd inference | `tests/core.rs`, `tests/authority.rs`, `test-zellij.mjs --scale` |
| Status glyph/color, selected row, model shorthand and uptime | `no_color "true"` fallback; `tests/color.rs`, `tests/presentation.rs` |
| Printable Unicode names, cell clipping, unsafe control/format filtering | `tests/core.rs`, `tests/presentation.rs`; projection byte bounds retained |
| Parent grouping and panel-local lead choice | Lead binds to process incarnation; missing/restarted choices never silently transfer. `tests/action_view.rs`, `tests/presentation.rs`, `test-actions-zellij.mjs` |
| j/k, arrows, wrapped rows and narrow paging | Paging counts lines, never half a row. Both lines map to the same mouse target. `tests/presentation.rs`, `test-zellij.mjs --scale` |
| Enter / mouse focus, tiled and hidden floating panes | Explicit permissioned client-local SDK path; `tests/focus.rs`, `test-actions-zellij.mjs --focus` |
| New with name entry and separate default-model confirmation | Serial native owner; `tests/action_view.rs`, `tests/executor.rs`, `test-actions-zellij.mjs` |
| Close with native pane preview, separate confirmation and expiry | Identity changes revoke approval; pane absence **and** unregister required for success. Same tests |
| Async cancellation, no queued confirmations, uncertain mutation inhibition | `tests/action_view.rs`, `tests/executor.rs`, `--focus` cancellation during native metadata wait |
| Quit (q / Ctrl-C), no permission request | SDK `close_self`; `test-actions-zellij.mjs --deny` verifies local quit with native actions disabled |
| Read-only default, bounded scoped reads, shared multi-client collector, idle cost | `tests/frames.rs`, `tests/inbox.rs`, `test-zellij.mjs --scale`, `--scale --crash` |

## Focus permission and identity boundary

Focus requires **all** of native `--actions`, plugin `actions "true"`, plugin
`focus "true"`, and an ordinary user-approved Zellij `ReadApplicationState` +
`ChangeApplicationState` permission prompt. Without the focus opt-in, no Zellij
permissions are requested. Denial keeps focus disabled and New/Close unchanged;
`test-actions-zellij.mjs --reject-focus` checks that fallback. These SDK permissions
are broad Zellij capabilities, not a security sandbox limiting arbitrary plugin
code to Focus. Do not enable them for an untrusted artifact.

The view observes the actual terminal-root PID through the SDK. The native owner
rereads full host metadata and canonical identity, scope, duplicate claims, process
generation and cwd, checks that the canonical agent descends from that terminal
root (including shell-launched Pi), then issues a one-second permit. The requesting
view consumes it once, bound to request, origin client, owner epoch and record
version. Before dispatch it checks its own client's focused pane, current
position-indexed PaneUpdate membership using the stable tab's SDK metadata, target
availability/layer/cwd hash, and terminal-root PID. It rechecks its own client
focus after SDK metadata calls, then verifies the SDK focus receipt. Cached SDK
membership can reject, never replace native validation. As with the original
metadata/dispatch path, these checks are not an atomic transaction with external
pane/process changes. Missing/expired checks refuse dispatch; there is no native
last-active-client fallback or automatic retry.

The live test makes another client last-active during delayed native metadata;
focus still reaches the requesting client and does not navigate the other one.
It also checks cold start, hidden floating/tiled focus, cancellation, tab reorder
(stable ID differs from position), and process cleanup. No fixture starts a model.

## Architecture differences, not removed controls

Registry refresh cadence belongs to the single native collector (`--interval`),
not one full registry scan per panel. A view's `r` rereads only its scoped snapshot.
The native `--prepare` JSON response and private `snapshot.json` files are the
native inspection interface; the original Node `--once`/`--json` CLI remains
available. Frames additionally label staleness, partial scans and owner shutdown.
Update the native collector and WASI artifact together when changing frame fields.

Run `bash check.sh` for unit, lint, native/WASI build and disposable Zellij checks.
Live installation/permission enablement is separate and requires operator approval;
this implementation does not edit layouts, permission caches or live sessions.

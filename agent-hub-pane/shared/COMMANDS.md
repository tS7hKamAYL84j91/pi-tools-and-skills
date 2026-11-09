# Native command owner: implementation contract

Jim requested existing-pane action parity, all Rust, a single native producer,
asynchronous New/Close, and deployment after validation. This extends the
read-only `b0374f4` baseline. Native New/Close and their WASI forms are implemented
and fixture-tested. **2026-11-09 update:** client-local Focus and display parity
are also implemented and validated; see [the parity audit](PARITY.md). Live
installation/permission enablement remains separate and requires approval.

## Small CQRS split

- WASI renders scoped projections and submits bounded intent. No Node runtime in
  the new control path and no agent mutation from a display snapshot.
- One native process owns collection/projection and one serial command executor.
  No new service daemon, generic workflow engine, event store or automatic retries.
- Native action processing is explicitly enabled; the default remains read-only.
  A private scoped command inbox delegates only fixed New/Close operations, not
  arbitrary argv, shell commands, messages or network access. This is an explicit
  native capability, not a way to silently bypass a denied Zellij permission.
- Collection continues independently of slow command metadata calls. Mutations
  are single-flight. A bounded executor/result channel is sufficient.

## States

Separate command outcomes from observed agents:

- command: pending -> awaiting confirmation -> executing -> succeeded/failed/uncertain;
- presentation: creating -> active; active -> deleting -> removed.

`active` requires matching live canonical registration. `removed` requires pane
absence and canonical unregister. These are observations, not optimistic receipts.
There is no separate enduring `deleted` state. Closing means the agent pane/process,
**never deleting session history, transcripts or arbitrary registry files**.

## Identity and approval

- Every request carries a unique ID, current owner epoch, scope, originating view,
  expiry and selected record identity/version. Scope routing comes from the private
  inbox configuration, not an arbitrary request path or session field.
- Prepare New/Close re-reads canonical state and full Zellij metadata. The owner
  retains an expiring binding to ID, PID/start, name/status, parent, session/pane,
  actual pane cwd and originating tab. Only the owner produces confirmation data.
- Preserve separate confirmation input: c then y/Enter, and New name entry then
  separate default-model confirmation; existing expiry and anti-double-Enter
  behavior remain. Cached row/version data can reject a request, never authorize it.
- Immediately before mutation, refresh full host metadata and canonical data after
  blocking calls. Refuse changed identity/scope/cwd, ambiguous claims, missing or
  unavailable panes, unverified processes, stale heartbeats and invalid names.
- Confirmed intent may finish after tab navigation, but never retargets to another
  agent/tab. Cancellation is explicit and best-effort after acceptance; do not
  report cancellation if a mutation may already have been dispatched.
- At most one mutation is dispatched at a time. No automatic retry on timeout,
  unknown result or restart. An uncertain mutation inhibits further mutations
  until it is reconciled or explicitly recovered by the operator.
- Fresh create receipts verify the unique returned pane in the intended tab,
  floating/not-exited, followed by matching canonical registration. Fresh close
  receipts include unselectable panes and later canonical unregister.

## Transport and privacy

- Commands and receipts are bounded private local data. No symlinks, FIFOs,
  directories-as-files, hardlink targets, unbounded queues or unchecked JSON fields.
  WASI cannot specify POSIX creation mode: the owned 0700 inbox confines handoff
  even under host umask0002; native ingestion verifies owner/single-link/regular
  file and tightens mode to0600 on the opened fd before reading.
- A fresh owner epoch rejects stale queued requests after restart. Bounded request
  deduplication and expiry prevent accidental replay within the current epoch.
- Confirmation guards stay native; do not export cwd, task, transcript or session
  paths into presentation snapshots. Private directories are not a same-user
  authentication boundary.
- New uses fixed argv and the existing child environment scrub: known Matrix
  credentials, parent ID and inherited session-directory binding removed;
  `PI_MATRIX_DISABLED=1`; explicit namespace/name; no model override or model call
  during tests. Name availability is checked against complete canonical state.

## Acceptance before rollout

Unit/fixture tests cover confirmation and expiry, changed identity after metadata
waits, duplicate and stale-epoch requests, queue bounds, forged routing, environment
scrubbing, name conflicts, serial dispatch, cancellation/uncertainty, and no replay
following abrupt death. Real disposable Zellij tests cover New/Close with a fake
`pi` executable, observed registration/unregister, multiple views, receipt failure,
selection/paging and unchanged idle collection cost. No fixture starts a model.

Superseded gap (2026-11-09): native Zellij CLI Focus still uses the last-active
client and is **never** dispatched. The implemented opt-in WASI path uses ordinary
explicit application-state permission approval, a short-lived single-use native
permit, pane-root process ancestry binding, scoped SDK membership/cwd checks and
originating-client receipt verification. New/Close remain owned by the native
executor; Focus changes client UI state only. See `PARITY.md` and
`test-actions-zellij.mjs --focus` / `--reject-focus`.

The parity audit covers selection, focus, lead choice, New, Close, cancellation,
mouse and narrow layouts. No live rollout, permission-cache edits, model-default,
schedule or human-relay privilege changes are made by this implementation.

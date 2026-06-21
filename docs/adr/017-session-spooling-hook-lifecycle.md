# ADR 017: Opt-in Session Spooling Hook Lifecycle

Status: Accepted-for-POC, not enabled by default

## Context

T-274 added a Panopticon-compatible session spooling POC that can write a local
registry record plus pi-compatible session JSONL for `agent_peek`/Panopticon
inspection. T-489 clarified the privacy posture: local private pi harness/session
logs are trusted personal input and may remain unredacted in local-only harness
paths, but unredacted logs must not be committed, pushed, shared, sent to
external providers, or exposed cross-agent without explicit approval. T-490 added
an off-by-default manifest installer CLI that requires an explicit local registry
directory and does not install a real hook.

The next risk is governance: if a real hook is installed later, the project needs
a durable decision about source of truth, invocation lifecycle, rollback,
retention, visibility, and activation gates.

## Decision

A real session-spooling hook may be implemented only as an explicit local opt-in
integration. No global/default hook is adopted by this ADR.

T-506 addendum: the canonical source root for approved local pi session-log
spooling is now the real pi session directory:

```text
~/.pi/agent/sessions/
```

The earlier isolated-source POC framing is superseded for this path. The runner
may accept a relative source path resolved inside that root, or an explicit test
source root for synthetic fixtures. It must not mutate, rewrite, prune, or
otherwise manage canonical session logs.

### Hook source of truth

The hook source of truth is a local manifest in the explicit registry directory:

```text
<registryDir>/session-spool-hook.json
```

The manifest records version, hook name, registry dir, retention cap, install
time, and posture. Future real hook code must treat this manifest as advisory
local state, not as permission to read or export arbitrary logs. The invoking
process must still pass the concrete session source path or parsed event stream
explicitly. For the approved local pi path, relative source paths are resolved
under `~/.pi/agent/sessions/` unless a test-only/synthetic `sourceRoot` is
provided.

T-510 addendum: `lib/session-spool-select-cli.ts` is a thin explicit UX wrapper
for this boundary. Its default mode is read-only discovery of recent source
files. It invokes the spooling runner only when the user supplies both
`--pick N` and `--spool` plus the explicit registry/name/cwd arguments. It does
not install hooks, start background work, mutate canonical session logs, or emit
raw session exports.

### Invocation lifecycle

A future hook runner may run at these boundaries only:

1. session start: create/update the local Panopticon registry record;
2. append/checkpoint: spool bounded recent activity from the active local session
   source;
3. session stop/shutdown: mark final status and prune bounded local output.

The hook must be best-effort and non-blocking. Failure to spool must not fail the
primary pi/Claude Code session. Errors are written to local diagnostics only and
must not include raw private payloads.

### Install, disable, uninstall

- Install requires an explicit absolute local registry directory. No implicit
  `~/.pi/agents` fallback is allowed for POC promotion.
- Install is idempotent and writes only the local manifest until a separate real
  hook runner is approved.
- Disable/uninstall removes the manifest and stops future hook invocations.
- Existing spooled fixture/output files may be pruned by the uninstall command
  only after a separate retention policy is implemented and tested.

### Local/private input boundary

Local private pi harness/session logs may be read unredacted by a local-only hook
runner on the same machine. This is trusted personal software. The allowed input
boundary does not imply permission to share, commit, push, externally process, or
cross-agent expose raw logs. Canonical logs under `~/.pi/agent/sessions/` remain
source-of-truth input only; derived output must be separate.

### Output boundary

Default hook output must be redacted/bounded if it is written into a Panopticon
registry directory that can be inspected by other agents through `agent_peek` or
other cross-agent surfaces.

An unredacted output mode is not accepted here. It requires a follow-up ADR that
identifies who can read it, how it is labelled, how it is deleted, and how it is
kept out of commits, remotes, and external providers.

### Retention and TTL

- Default retention cap remains at most 100 spooled events per session record.
- Future real hooks must support pruning by count and/or TTL before activation.
- Persistent databases or long-term stores are out of scope for this lifecycle.

### Cross-agent visibility

Cross-agent visibility is opt-in via the selected local registry directory. The
hook must label records as spool-originated (for example
`claude-code/session-spool`) and scoped by default. Exposing unredacted private
logs cross-agent is prohibited without explicit approval and a new ADR.

### External export constraints

The hook must not send session logs, spooled output, diagnostics, or journals to
external providers. Any external export, remote sync, or model-provider upload is
a separate feature requiring explicit approval, redaction policy, and review.

### Failure and rollback

- Hook failures are non-fatal to the primary session.
- Partial writes must be local and replaceable; readers must tolerate missing or
  malformed spooled records.
- Rollback is uninstall plus deletion/pruning of the explicit local registry
  artifacts created by the hook.
- The hook must avoid following symlink registry directories and must confine
  writes under the configured registry dir.

### Activation gate

Before any real hook runner is activated, the change must receive reviewer or
Navigator PASS covering:

- exact source path/event stream contract;
- install/uninstall smoke tests;
- redacted output fixture tests;
- local retention/pruning tests;
- gitleaks/secret sanity;
- docs for disabling and deleting local artifacts.

## Consequences

- T-274/T-490 remain safe POCs: they define adapter and installer mechanics but
  do not install a real default hook.
- The next implementation can be narrow: a local runner that consumes an explicit
  session source and writes bounded redacted Panopticon-compatible output.
- The project preserves T-489's trusted local-input posture without weakening
  committed artifact, cross-agent, or external export safety.
- Any unredacted output or broader sharing requires another ADR.

## Follow-up task recommendation

T-491A: Implement a real local hook runner behind the existing manifest gate.
Acceptance should include explicit session source path/config, redacted bounded
output, pruning, install/uninstall smoke tests, and no default enablement.

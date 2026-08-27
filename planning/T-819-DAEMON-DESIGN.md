# T-819 Design Doc: coas-daemon Implementation Mechanics

- **Status:** Draft for independent review (gates T-867+)
- **Owner:** pi-tools-and-skills-gm (implementation lead)
- **Binding requirements:** ADR-0018 sections 1–8 (`working-notes/docs/adrs/0018-daemon-backed-sessions.md` @ `c9f738e`) — this doc **references, never restates** them. Any conflict with the ADR is resolved in favour of the ADR and is a material change requiring council re-review (validation gate (e)).
- **Implements:** ADR-0018 Implementation path items 1–6, using the mechanics the scope seat deferred to this doc.
- **Review plan:** independent review (security seat + one GM peer) → revisions → T-867 starts only after review sign-off is recorded on this file's status line.

## 1. Repository and packaging placement

- New top-level package **`daemon/`** in pi-tools-and-skills, package name `coas-daemon`.
  - Rationale: the daemon must run without pi; `extensions/pi-coas` is loaded only inside pi. `lib/` stays the shared runtime layer — the daemon imports `lib/file-persistence.ts` and `lib/path-inside.ts` (shared persistence helpers, per the runtime-state boundary test) but never imports extension modules.
  - Own `tsconfig.json` (strict flags identical to root), build output `daemon/dist/`. No new npm dependencies: Node ≥ 22 stdlib only (`node:crypto` Ed25519, `node:fs`, `node:os`, `node:net`). Node ≥ 22 LTS pinned in `daemon/package.json` `engines` (matches repo `engines.node`).
  - Launcher: `daemon/dist/coas-daemon.mjs` via systemd user unit (`coas-daemon.service`, `Restart=no` — the failure-threshold policy owns restarts) or `nohup` fallback. **No implicit start** from Zellij/pi launches (ADR Non-actions); start is an explicit Principal/Quartermaster action.
- Panopticon/pi side gains `extensions/pi-panopticon/daemon-client/` (socket client) behind an opt-in env flag `COAS_DAEMON_ENABLED=1` (ADR-0009 deny-by-default; flag unset ⇒ incumbent in-pi behaviour, byte-for-byte).

## 2. Store hierarchy layout

Two roots, both daemon-owned:

```text
$XDG_RUNTIME_DIR/coas/          0700 dir (runtime, recreated at boot)
  daemon.sock                   0600 unix socket
  daemon.lock                   flock target (LOCK_EX, held for daemon lifetime)

$XDG_DATA_HOME/coas-daemon/     0700 (durable state; survives reboot)
  registry/
    identities/<agent_id>.json          signed identity record (§ADR-2)
    policy.json                         signed allowlist policy (§ADR-6/8)
  queue/
    <recipient_agent_id>/<message_id>.json      envelope + delivery state
    dead-letter/<message_id>.json
    quarantine/<name>.rejected                  corrupt/integrity-failed raw bytes
  schedule-state/<task_id>.json                 delivery lease/claim-check state
  sessions/<agent_id>/                          durable subagent session dir pointers
  keys/public/<key_id>.pub                      retained verification keys
  audit/audit-YYYY-MM-DD.log                    append-only audit (0600)
```

Rules: validated opaque ids only as path components (`assertSafeAgentId` discipline, reused from `lib/transports/maildir.ts`); user-provided names never enter paths (§ADR-6); every directory 0700, file 0600 under umask `077`; policy and identity records are themselves signed (§ADR-8).

## 3. Durability: exact fsync ordering

**Envelope commit (enqueue):** serialize canonical bytes → write `<message_id>.json.tmp` (O_CREAT|O_EXCL|O_NOFOLLOW, 0600) → `fsync(file)` → `rename(tmp, final)` (no-replace: fail if target exists) → `fsync(queue/<recipient>/ dir)` → **only then** ack the enqueue and emit the queued state. This satisfies §ADR-4 "durably commit before acknowledging".

**Generation/identity record commit:** identity record write follows the same temp+fsync+rename sequence, plus **dir fsync of `registry/identities/`** before the daemon acknowledges admission or binds a live instance. Ordering rule: an identity record with generation N is durable **before** any envelope referencing instance-generation N is enqueued, and before the instance binding is published to clients. A crash between rename and dir-fsync is absorbed by idempotent recovery (§5 below): replay re-validates owner/mode/type and re-fsyncs; no double-publish because rename is no-replace.

**Directory fsync cadence:** after every create/rename in `queue/`, `identities/`, and `keys/public/`. Audit log appends are `O_APPEND` + per-line fsync is **not** required (audit is advisory; queue durability is mandatory).

## 4. Corrupt-tail parsing mechanics

- **Format:** all durable JSON records are single-object files with a trailing newline, or append-only `\n`-delimited JSON logs (audit only).
- **Parser contract (`parseRecordOrQuarantine`):**
  1. read bytes; reject BOM, trailing garbage after the JSON document, duplicate keys (use a strict reviver that throws on repeats), NaN/Infinity, and size over the schema cap (see §8);
  2. on **any** parse/schema/size failure: atomically move the offending file to `queue/quarantine/<name>.<reason>.<ts>` (same-directory rename, validated target), emit an audit event `{kind:"quarantine", path, reason, offsetHint}`, and continue with the last known-good record set;
  3. the queue/state scan **never truncates, never deletes, never rewrites in place** — quarantine is a move, the raw bytes are preserved (ADR §7 policy);
  4. recovery is idempotent: replaying recovery after quarantine is a no-op; quarantine of the same file twice is a no-op.
- Partial-line tails in append-only audit logs are ignored up to the last complete line (advisory data), but a corrupt *state* record is always quarantined, never skipped silently.

## 5. Per-class execution semantics

| Class | Guarantee | Mechanism | On failure |
|---|---|---|---|
| A2A delivery | **At-least-once**, recipient dedupes on `message_id` (ADR §3/4) | Lease state machine: `queued→leased→delivered`; lease TTL 60s; atomic compare-and-set on `(recipient_agent_id, message_id)`; ack only from the authenticated recipient binding authorized by the envelope generation policy | Lease expiry → retry with bounded backoff (1s,2s,4s,8s,16s; max 5 attempts) → `dead_letter(reason=attempts_exhausted)` |
| Schedule execution | **At-most-once per cycle** | Exclusive daemon lock (§ADR-7) + `minuteKey` dedupe + ADR-0008 claim-check/dry-run guard on every delivery; M1: missed cycles coalesce to one fire after wake | Guard fail → drop+log+alert, never force-queue (ADR-0008 (4)) |
| Enqueue | Exactly-once observable outcome per `(recipient_agent_id, idempotency_key)` | Re-submission returns the prior outcome (ADR §4) | Malformed/tampered → quarantine + audit |
| Admin op (rebind/policy/takeover/purge) | Serialized, auditable | Signed policy/identity records, CAS on generation, audit append | Invalid/unsigned → rejected fail-closed (ADR §8) |

Recovery replay scope: non-terminal queue records + registry/session rebuild (identity continuity, stale live-instance invalidation, session dir pointers, schedule claim-check state). Idempotent by construction (§ADR-7).

## 6. M5 — single-writer serialization (pi-yields)

- The daemon registry records an optional **writer-role lease**: `{ role: "gravitas-writer", holder: agent_id, instance_id, expires_at }`.
- A pi session claims the writer role at admission (authenticated, first-wins, CAS); the claim is refreshed by the daemon's heartbeat for that binding and expires 30s after the binding dies.
- Daemon-ticked delivery of **Gravitas-owned scheduled work** (workspaces tagged `writer: gravitas` in schedule metadata — tag introduced by this doc, additive, no schedule-file format change) is **deferred** while a live claim exists: re-checked each tick, counted as `deferred_writer`, never queued beyond the next tick.
- Everything else delivers normally; there is no ordering guarantee across classes (ADR M7).
- `pi close` / daemon stop releases the claim on disconnect. Two live claims cannot exist (one-live-binding rule, ADR M3).

## 7. M6 — registry handoff and `registry.ts` transition

- **Sync protocol (socket, same authenticated envelope):**
  1. pi connects → `hello` (peer-cred admission per §ADR-2) → `registry.subscribe`;
  2. daemon replies with a full snapshot (`seq`, records) then per-change events with monotonically increasing `seq`;
  3. panopticon applies events in order, resyncs on seq gap (snapshot again).
- **Panopticon changes:** `registry.ts` keeps its `AgentRecord` view-model; a new `daemon-registry-source.ts` adapts daemon registry records → `AgentRecord`; `list_spawned`/`agent_status`/`agent_peek` read daemon-backed state when `COAS_DAEMON_ENABLED=1`, else the incumbent shared-disk registry. Heartbeat ownership moves to the daemon for daemon-managed agents; `registry-persistence.ts` writes are bypassed in daemon mode (panopticon becomes read-only consumer + control-request sender).
- **Migration:** at first daemon admission, existing Panopticon spawn records are enumerated and the daemon mints `agent_id`s (opaque, stable), recorded in `identities/`; the Panopticon name becomes a display alias only (§ADR-5).
- **Transition rule:** `extensions/pi-panopticon/registry/registry.ts` keeps the interface; the source swaps behind the flag. No dual-write, ever — exactly one registry authority per workspace state (daemon or incumbent), chosen at session start.

## 8. Resource caps and observability counters

| Limit | Value (initial) | Notes |
|---|---|---|
| Message size cap | 256 KiB payload | enforced at parse and enqueue; larger → dead_letter(oversized) |
| Queue depth per recipient | 200 | overflow → dead_letter(full) |
| Delivery attempts | 5 | backoff per §5 table |
| Lease TTL | 60 s | expiry → retry |
| Envelope schema cap | 64 KiB serialized envelope excl. payload | |
| Live bindings (daemon-wide) | 64 | M3 one-per-agent included |
| Schedule frequency (daemon-ticked) | ≥ 5 min per task | schedule files unchanged; daemon refuses tighter crons in daemon mode |

**M4 counters** (exposed via `coas_status` under `daemon`): `uptime_s`, `ticks`, `delivered`, `retried`, `dead_lettered` (by reason), `dropped` (guard), `quarantined`, `deferred_pi_yields`, `active_bindings`, `last_tick_at`. Health heartbeat every 5 s on the control socket; `coas_status` renders from it when the daemon is enabled.

## 9. Security-position selection (ADR §1 requirement)

**Initial implementation position: `same_uid_untrusted`.** All agents currently run under the Principal's UID without per-agent sandboxing. Per ADR §1 this means: durable routing and best-effort attribution only; sender identity is **not** presented as authenticated; administrative operations are disabled fail-closed (§ADR-8) and require the Principal/Quartermaster via a local operator channel; the mode label `same_uid_untrusted` is stamped in registry status output and every delivery audit record. The Ed25519 integrity key still defends against tampering and rollback replay (expiry bound), but not against same-UID processes. Upgrading to authenticated mode (per-agent OS identities or enforced sandbox profiles) is a follow-up work-order; the identity/admission code is written so the position is a configuration, not a rewrite.

**Key material:** Ed25519 integrity key generated at first daemon start, private key placed in the OS keyring via `secret-tool` (libsecret) or, when unavailable, a 0600 file under the state root with a startup warning that same-UID protection is not in force. Public verification keys retained per `key_id` (§ADR-3 rotation).

## 10. Resource failure and rollback

Failure threshold, rollback, and exit path are as specified in ADR-0018 (Rollback, migration, and exit path): auto-disable at ≥3 crashes/24h or any state-corruption event, alert to Principal/Lumen, revert to in-pi scheduler; queues retained read-only; in-flight messages dead-lettered `daemon_disabled`.

## 11. Acceptance criteria mapping (feeds T-872)

| ADR validation gate | Design element | Test surface |
|---|---|---|
| exactly-once under lease model | §5 lease table | property tests: concurrent delivery of one lease |
| dedupe under idempotency replay | §5 enqueue row, §ADR-4 | re-enqueue same key → prior outcome |
| dead-letter on tamper/expiry | §2 store, §5 tables | flip payload byte / expired envelope → dead_letter |
| idempotent crash recovery | §3 fsync ordering, §4 quarantine | kill -9 mid-tick/mid-delivery; replay recovery twice → no-op |
| corrupt-tail quarantine | §4 mechanics | truncate/corrupt record → quarantine move + audit, good state resumes |
| guard-drift fail-closed | §5 schedule row (ADR-0008 seam) | modified guard input → drop+log+alert, never delivered |

## 12. Non-goals (mirroring ADR Non-actions)

No agent execution in the daemon, no model/provider access, no remote exposure, no extension loading, no automatic startup, no Zellij replacement beyond what coas-pi deprecation (Q-coordinated, post-parallel-run) removes.
# T-819 Design Doc: coas-daemon Implementation Mechanics

- **Status:** Reviewed — rev 2 @ `a6cd343` PASSED one-line re-checks by both seats (security seat: F1–F5 ✔; formal seat: F1–F3 majors resolved, no new counterexample; disposition via chief-of-staff 2026-08-27). Rev 1 @ `0741e4b` reviewed REVISE by both seats (`working-notes/docs/reviews/t-866-design-review-{security,formal}.md` @ `d5d1db2`); all findings incorporated. **T-867+ unblocked.**
- **Owner:** pi-tools-and-skills-gm (implementation lead)
- **Binding requirements:** ADR-0018 sections 1–8 (`working-notes/docs/adrs/0018-daemon-backed-sessions.md` @ `c9f738e`) — this doc **references, never restates** them. Any conflict with the ADR is resolved in favour of the ADR and is a material change requiring council re-review (validation gate (e)).
- **Implements:** ADR-0018 Implementation path items 1–6, using the mechanics the scope seat deferred to this doc.

## 1. Repository and packaging placement

- New top-level package **`daemon/`** in pi-tools-and-skills, package name `coas-daemon`.
  - Rationale: the daemon must run without pi; `extensions/pi-coas` is loaded only inside pi. `lib/` stays the shared runtime layer — the daemon imports `lib/file-persistence.ts` and `lib/path-inside.ts` (shared persistence helpers, per the runtime-state boundary test) but never imports extension modules.
  - Own `tsconfig.json` (strict flags identical to root), build output `daemon/dist/`. No new npm dependencies: Node ≥ 22 stdlib only (`node:crypto` Ed25519, `node:fs`, `node:os`, `node:net`). Node ≥ 22 LTS pinned in `daemon/package.json` `engines` (matches repo `engines.node`).
  - Launcher: `daemon/dist/coas-daemon.mjs` via systemd user unit (`coas-daemon.service`, `Restart=no` — the failure-threshold policy owns restarts) or `nohup` fallback. **No implicit start** from Zellij/pi launches (ADR Non-actions); start is an explicit Principal/Quartermaster action.
  - **Safe-creation binding (ADR §6, by reference):** every creation, recovery, and socket path in the daemon — runtime dir, socket bind/publication, queue/identity/audit files, recovery re-validation — implements the ADR §6 checklist verbatim: pre-opened trusted directory FDs anchored at the validated state root; `openat2 RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS` where available, else component-by-component `openat`/`mkdirat` with `O_NOFOLLOW` + `fstat` verification; symlink, wrong-type, wrong-owner/mode, and hard-linked-regular-file rejection; socket mode set **before** publication and publish-only-after validation with validate-before-unlink (owner, type, directory identity, daemon liveness); FD re-checks so path substitution between validation and use fails closed. Every ownership/mode/type/atomicity/containment check failure is fail-closed **and audited**. This doc does not weaken or re-enumerate §ADR-6; implementations cite it directly.
- Panopticon/pi side gains `extensions/pi-panopticon/daemon-client/` (socket client) behind an opt-in env flag `COAS_DAEMON_ENABLED=1` (ADR-0009 deny-by-default; flag unset ⇒ incumbent in-pi behaviour, byte-for-byte).

## 2. Store hierarchy layout

Two roots, both daemon-owned:

```text
$XDG_RUNTIME_DIR/coas/          0700 dir (runtime, recreated at boot)
  daemon.sock                   0600 unix socket (mode set before publication)
  daemon.lock                   flock target (LOCK_EX, held for daemon lifetime)

$XDG_DATA_HOME/coas-daemon/     0700 (durable state; survives reboot)
  registry/
    identities/<agent_id>.json          signed identity record (§ADR-2)
    writer-lease.json                   M5 writer-role lease record
    policy.json                         signed allowlist policy (§ADR-6/8)
  queue/
    <recipient_agent_id>/<message_id>.json      envelope + delivery state
    dead-letter/<message_id>.json
    quarantine/<original-name>.<reason>         raw bytes, preserved verbatim
  schedule-state/<task_id>.json                 claim-check + guard-input snapshot
  sessions/<agent_id>/                          durable subagent session dir pointers
  keys/public/<key_id>.pub                      retained verification keys
  audit/audit-YYYY-MM-DD.log                    append-only audit (0600)
```

Rules: validated opaque ids only as path components (`assertSafeAgentId` discipline, reused from `lib/transports/maildir.ts`); user-provided names never enter paths (§ADR-6); every directory 0700, file 0600 under umask `077`; policy, identity, and writer-lease records are themselves signed (§ADR-8). **Lock ordering:** the flock on `daemon.lock` is acquired before any state read/write and **before** socket bind; a second daemon instance fails closed with an audit event (§ADR-7). **Quarantine/dead-letter mapping:** raw bytes of any record failing integrity/schema verification move to `quarantine/` (evidence surface); a dead-letter record referencing the quarantine path, with reason, is written to `dead-letter/` when the record is a deliverable envelope (so counters and §ADR-3's "quarantined dead-letter record" both hold). Administrative-action audit records are `fsync`'d at write time — they are the accountability trail for fail-closed rejections. Regular delivery-audit lines stay advisory (no per-line fsync), with the explicit carve-out that the quarantined file itself is the durable evidence for partial-tail cases.

## 3. Durability: exact fsync ordering

**Envelope commit (enqueue):** serialize canonical bytes → write `<message_id>.json.tmp` (O_CREAT|O_EXCL|O_NOFOLLOW, 0600) → `fsync(file)` → `rename(tmp, final)` (no-replace: fail if target exists) → `fsync(queue/<recipient>/ dir)` → **only then** ack the enqueue and emit the queued state. This satisfies §ADR-4 "durably commit before acknowledging".

**Schedule claim-check write-ahead (F2, before envelope):** for a daemon-ticked schedule fire, the durable commit order is: (1) `schedule-state/<task_id>.json` claim-check — `{minuteKey, firedAt, guardInputSnapshot}` — temp+fsync+no-replace-rename+dir-fsync; **(2)** only then the delivery envelope enqueue (§3 above). Recovery treats schedule-state as **authoritative** for already-fired cycles. Accepted failure mode: `kill -9` between (1) and (2) ⇒ **the cycle is lost, not duplicated** (at-most-once holds; asserted by T-872). The inverse (envelope-first) ordering is explicitly forbidden.

**Generation/identity record commit:** identity record write follows the same temp+fsync+rename sequence, plus **dir fsync of `registry/identities/`** before the daemon acknowledges admission or binds a live instance. Ordering rule: an identity record with generation N is durable **before** any envelope referencing instance-generation N is enqueued, and before the instance binding is published to clients.

**Rename completion and tmp hygiene:** recovery **redoes** interrupted `tmp → final` renames it can validate (target absent, tmp intact, same directory, checks per §ADR-6) rather than merely re-fsyncing — a re-fsync cannot resurrect a rename that did not survive; `.tmp` files it cannot validate are removed with an audit event (stale tmp sweep). Directory fsync applies after every create/rename in `queue/` (including subdirectories and cross-directory moves such as quarantine — **both** directories are fsynced), `identities/`, and `keys/public/`.

## 4. Corrupt-tail parsing mechanics

- **Format:** all durable JSON records are single-object files with a trailing newline, or append-only `\n`-delimited JSON logs (audit only).
- **Parser contract (`parseRecordOrQuarantine`):**
  1. read bytes; reject BOM, trailing garbage after the JSON document, duplicate keys (strict reviver that throws on repeats), NaN/Infinity, and size over the schema cap (§8);
  2. on **any** parse/schema/size failure: move the offending file to `quarantine/<source-name>.<reason>.<ts>` (validated move per §ADR-6), emit an audit event `{kind:"quarantine", path, reason, offsetHint}`, and continue with the last known-good record set;
  3. the queue/state scan **never truncates, never deletes, never rewrites in place** — quarantine is a move, the raw bytes are preserved (ADR §7 policy). Quarantine idempotency is keyed by **source path**: a source that is already gone is a no-op, so replaying recovery never double-quarantines;
  4. quarantine moves cross directories (`queue/<recipient>/` → `queue/quarantine/`); durability requires fsync of **both** directories;
  5. recovery is idempotent: replaying recovery after quarantine is a no-op.
- Partial-line tails in append-only audit logs are ignored up to the last complete line (advisory data; the quarantined file itself is the durable evidence), but a corrupt *state* record is always quarantined, never skipped silently.

## 5. Per-class execution semantics

| Class | Guarantee | Mechanism | On failure |
|---|---|---|---|
| A2A delivery | **At-least-once**, recipient dedupes on `message_id` (ADR §3/4) | Lease state machine (full transition table below); CAS on `(recipient_agent_id, message_id)`; ack only from the authenticated recipient binding authorized by the envelope generation policy | See lease table below; attempts are accounted only against live-binding failures (F3) |
| A2A enqueue | Deny-by-default authorization **before** enqueue (§ADR-6): allowlist check over sender/recipient agent ids, message type, optional exact generation; failure → rejected + audit, fail-closed | Exactly-once observable outcome per `(recipient_agent_id, idempotency_key)`; re-submission returns the prior outcome (§ADR-4) | Envelope/integrity failure → quarantine + audit; never delivered |
| Schedule execution | **At-most-once per cycle** (write-ahead: claim-check committed before envelope; §3) | Exclusive daemon lock (§ADR-7) + `minuteKey` dedupe + ADR-0008 claim-check/dry-run guard on every delivery; M1: missed cycles coalesce to one fire after wake; M5: writer-tagged work deferred per §6 with coalesced release-fire | Guard fail → drop+log+alert, never force-queue (ADR-0008 (4)); lost cycle possible (accepted), duplicate cycle never |
| Admin op (rebind/policy/takeover/purge) | Serialized, auditable | Signed policy/identity records, CAS on generation, **fsync'd** audit append | Invalid/unsigned → rejected fail-closed (§ADR-8) |

**Delivery-seam rule (restated per security review F3):** every schedule delivery the daemon performs traverses the same authenticated envelope and delivery-guard path as A2A messages — the daemon-ticked scheduler never bypasses the ADR-0008 guard.

**Lease transition table (F4):** states `queued | leased | delivered | dead_letter | parked`. Terminal: `delivered`, `dead_letter`. Edges:

| From | Event | To | Counter |
|---|---|---|---|
| queued | lease granted (CAS) | leased | `retried` if attempt count > 0 |
| leased | delivery attempted against **authenticated live binding** and failed (timeout/reset/write error) | queued, attempts+1, backoff timer armed | `retried++` |
| leased | TTL (60s) expiry, no ack | **queued** (re-lease eligible; attempts unchanged) | — |
| leased | ack from authorized binding | delivered (**terminal**) | `delivered++` |
| leased | ack from expired/re-granted lease (stale holder) | **no-op** (lease unchanged) | audit event `stale_ack` |
| delivered | any further event | **rejected** (terminal, no CAS) | audit `terminal_violation` |
| parked (binding absent) | binding appears (recipient reconnects) | queued (delivery eligible) | — |
| queued/parked | attempts exhausted on live failures | dead_letter(reason=attempts_exhausted) (**terminal**) | `dead_lettered++` |
| any non-terminal | `expires_at` passed | dead_letter(reason=expired) (**terminal**) | `dead_lettered++` |
| queued/parked | attempts exhausted → dead_letter; **late ack afterwards** | stays dead_letter (terminal, no CAS); ack logged + audit `late_ack_dead_letter`; recipient dedupe record makes re-delivery impossible | audit only |
| any | integrity/schema failure | dead_letter(reason=integrity_failed) + raw bytes → quarantine | `quarantined++` |

**Attempt accounting (F3):** attempts count **only** against delivery attempts made to an authenticated live binding that failed. An absent/expired binding parks the message (`waiting_for_binding` — no attempt consumption, no backoff); the only timers on a parked message are `expires_at` and the queue-depth cap. Retry backoff (1s,2s,4s,8s,16s; max 5 live-failed attempts) governs only the `retrying` path. A recipient offline for 10 minutes reconnects ⇒ parked message delivers (unless expired) — never `attempts_exhausted`.

**Idempotency index durability (F5):** the `key → outcome` map is **derived by scan** from durable state — envelopes carry `idempotency_key`, so recovery rebuilds the index from `queue/` + `dead-letter/` scans; no separate index file to lose. Concurrent same-key enqueue is serialized by a per-recipient advisory lock inside the daemon (single process, `flock`-held authority); the second submission returns the first outcome.

**Recipient dedupe contract (F6):** recipients durably record `message_id` **before** acking (persist-seen-before-ack). Recipients that ack-then-crash without persisting must expect re-delivery and dedupe by persisted `message_id`; this ordering is a stated contract tested by T-872.

**M2 supervision (mechanics, per security advisory):** persistent subagents re-parent to the daemon at admission (`setsid` semantics); a crashed subagent is re-admitted as a **new generation** with bounded backoff (1s→2s→…→60s cap, reset on stability) — never silently respawned in place; `pi close` drains mid-turn agents with a 10s grace, then aborts.

### 5a. ADR-0008 guard-input mapping (role-drift firewall; security review F2)

At each schedule fire the daemon derives the guard inputs **from daemon-owned state only**, and snapshots them into the schedule-state claim record **at trigger time** (ADR-0008 decision 5 — never at delivery):

- `parentId` — the `parent_agent_id` of the target binding from the daemon registry identity record (null for root admissions); never a display name or caller-supplied field.
- `visibility` — the registry record's visibility tag, migrated from Panopticon spawn metadata at first admission and thereafter daemon-owned.
- `scope` — the binding's admission scope (`root` | `task` | `workspace`), stamped by the daemon at admission from the spawn request's ADR-0008 (7) tag; the **root-vs-branch gate (ADR-0008 decision 6) is a hard prerequisite**: daemon-ticked delivery targets root-admitted bindings only; a `task`-scoped binding is never a delivery target.
- The snapshot is written into the claim-check record (§3 step 1) so the envelope's guard inputs are the trigger-time values even if registry state changes mid-tick; guard evaluation at delivery uses the snapshot, and a mismatch vs the live record → drop+log+alert.

## 6. M5 — single-writer serialization (pi-yields; formal review F1)

- The daemon registry holds a durable, signed **writer-role lease**: `{ role: "gravitas-writer", holder: agent_id, instance_id, generation, claimed_at }` — durable state, not in-memory-only.
- A pi session claims the role at admission (first-wins, CAS); the daemon refreshes the claim from its own heartbeat for that binding (no separate client traffic), and the claim **expires 30s after the binding dies**.
- **Deferred-work end state (no starvation):** each deferred cycle is coalesced (one pending cycle per schedule, M1-consistent) and fires **on the first tick after the claim is released**. Bounded staleness is documented (work runs when the writer session disconnects/relinquishes). After **N = 3 consecutive deferrals** of the same due cycle, the daemon raises an alert to the Principal/Lumen channel (drop+log+alert leg) instead of starving silently.
- **Daemon-restart recovery:** a surviving durable lease is **invalidated and re-armed** at startup: the live session re-claims on reconnect; until reclaim (bounded grace 30s) writer-tagged cycles neither fire into a fresh spawn nor run in the session — no double-writer window; after the grace with no re-claim, the coalesced fire proceeds through the normal guard path.
- **Tick authority:** in daemon mode the daemon is the **sole** tick source for writer-tagged schedules; the live writer session runs no in-pi tick for them (no cross-tick dedupe needed). The daemon may deliver the coalesced cycle **to the live writer session** (pi-yields handoff) — that delivery is the M5 "defers delivery to it" leg — or, if the writer session is gone, through the normal guard path.
- Delivery uses the same non-blocking model as §5/§8; two live claims cannot exist (ADR M3).

## 7. M6 — registry handoff and `registry.ts` transition

- **Sync protocol (socket, same authenticated envelope):**
  1. pi connects → `hello` (peer-cred admission per §ADR-2) → `registry.subscribe`;
  2. daemon replies with a full snapshot taken atomically under the registry lock (`seq`), then per-change events with monotonically increasing `seq`;
  3. client rules (formal review F7): buffer incoming events until the snapshot is applied; **drop events with `seq ≤` the snapshot's seq** (already contained in the snapshot); apply thereafter in order; resync (fresh snapshot) only on a true gap (`seq >` expected+1). Snapshot is a single-lock atomic read, never a scan events can interleave with.
- **Panopticon changes:** `registry.ts` keeps its `AgentRecord` view-model; a new `daemon-registry-source.ts` adapts daemon registry records → `AgentRecord`; `list_spawned`/`agent_status`/`agent_peek` read daemon-backed state when `COAS_DAEMON_ENABLED=1`, else the incumbent shared-disk registry. Heartbeat ownership moves to the daemon for daemon-managed agents; `registry-persistence.ts` writes are bypassed in daemon mode (panopticon becomes read-only consumer + control-request sender).
- **Mixed-mode matrix (transition period, fail-closed by design):**

| From \ To | daemon workspace | incumbent workspace |
|---|---|---|
| daemon workspace | full A2A + registry | **fail-closed**: no daemon `agent_id` exists for incumbent agents; enqueue rejected + audited; ADR-0008 guard inputs unmapped → drop+log+alert |
| incumbent workspace | **fail-closed**: incumbent has no daemon admission; its registry is blind to daemon agents | unchanged incumbent behaviour |

- **Migration:** at first daemon admission, existing Panopticon spawn records are enumerated and the daemon mints `agent_id`s (opaque, stable), recorded in `identities/`; the Panopticon name becomes a display alias only (§ADR-5).
- **Transition rule:** `extensions/pi-panopticon/registry/registry.ts` keeps the interface; the source swaps behind the flag. No dual-write, ever — exactly one registry authority per workspace state (daemon or incumbent), chosen at session start.

## 8. Delivery execution model, resource caps, and observability

**Non-blocking delivery (formal review F8):** all socket writes are non-blocking with a per-delivery timeout of 5s (< 60s lease TTL); a hung/SIGSTOPed recipient times out, its lease expires per the table, and the tick continues. Per-tick delivery budget: 32 deliveries; per-recipient round-robin fairness — one bad binding cannot starve others. No crash occurs in this state, so the §10 failure threshold is not the breaker; the timeout + budget are.

| Limit | Value (initial) | Notes |
|---|---|---|
| Message size cap | 256 KiB payload | enforced at parse and enqueue; larger → dead_letter(oversized) |
| Queue depth per recipient | 200 | overflow → dead_letter(full) |
| Delivery attempts | 5 **live-binding** failures | parked messages burn nothing (§5, F3) |
| Lease TTL | 60 s | expiry → queued (re-lease) |
| Delivery socket timeout | 5 s | < lease TTL; non-blocking writes |
| Per-tick delivery budget | 32 | round-robin fairness |
| Envelope schema cap | 64 KiB serialized envelope excl. payload | |
| Live bindings (daemon-wide) | 64 | M3 one-per-agent included |
| Schedule frequency (daemon-ticked) | ≥ 5 min per task | schedule files unchanged; daemon refuses tighter crons in daemon mode |

**M4 counters** (exposed via `coas_status` under `daemon`): `uptime_s`, `ticks`, `delivered`, `retried`, `parked`, `dead_lettered` (by reason), `dropped` (guard), `quarantined`, `deferred_pi_yields`, `deferred_writer_alerts`, `active_bindings`, `last_tick_at`. Health heartbeat every 5 s on the control socket; `coas_status` renders from it when the daemon is enabled.

## 9. Security position, admin channel, and key material (ADR §1/§8)

**Position: `same_uid_untrusted` (initial).** All agents currently run under the Principal's UID without per-agent sandboxing. Per ADR §1: durable routing and best-effort attribution only; sender identity is **not** presented as authenticated; the label `same_uid_untrusted` is stamped in registry status output and every delivery audit record — and this labelling is **test-enforced** (§11 row a), not merely described. Upgrading to authenticated mode (per-agent OS identities or enforced sandbox profiles) is a follow-up work-order; the identity/admission code is written so the position is a configuration, not a rewrite.

**Admin operator channel (security review F1 — the posture's main compensating control):** administrative operations run **only** through `coas-daemon-admin`, a CLI executed interactively by the Principal/Quartermaster on the daemon host. Its agent-unreachability property is **knowledge-based, not filesystem-based** (filesystem ownership is insufficient under a shared UID — ADR §1): the CLI prompts for the admin passphrase, held **only in the operator process's memory** — never on disk, never in the environment, never derivable from any agent-readable artifact — and proves it to the daemon as an HMAC challenge over the passphrase-derived key. The daemon's agent-facing socket rejects every admin opcode fail-closed with an audit event in this mode; the admin channel is a **separate** control socket whose admission requires that passphrase proof. Honest residual: a same-UID agent that learns the passphrase (e.g., shoulder-surf or process inspection of the operator CLI) could act — the control is that the secret exists only in human-held memory during interactive use, and every admin action is audited with the acting credential id. Authenticated mode (per-agent sandboxes) strengthens this to possession-based isolation.

**Key material:** Ed25519 integrity key generated at first daemon start; private key placed in the OS keyring via `secret-tool` (libsecret). **Fallback disposition (recorded deviation):** when the keyring is unavailable, a 0600 file under the state root is used **only while `same_uid_untrusted` holds** — it is an explicit, temporary deviation from the ADR Guardrails' keyring requirement (materially harmless here since anti-spoof is already withdrawn and the key defends tamper-evidence, not access), the fallback emits an **audit event** (not just a console warning), and it is **forbidden once authenticated mode ships**. Public verification keys retained per `key_id` (§ADR-3 rotation).

## 10. Resource failure and rollback

Failure threshold, rollback, and exit path are as specified in ADR-0018 (Rollback, migration, and exit path): auto-disable at ≥3 crashes/24h or any state-corruption event, alert to Principal/Lumen, revert to in-pi scheduler; queues retained read-only; in-flight messages dead-lettered `daemon_disabled`.

## 11. Acceptance criteria mapping (feeds T-872)

| # | ADR validation gate / review finding | Design element | Test surface |
|---|---|---|---|
| 1 | exactly-once under lease model | §5 lease table | property tests: concurrent delivery of one lease |
| 2 | dedupe under idempotency replay | §5 enqueue row; §3 durability; idempotency index derived by scan (F5) | re-enqueue same key → prior outcome; **re-enqueue after crash → prior outcome** |
| 3 | dead-letter on tamper/expiry | §2 quarantine/dead-letter mapping | flip payload byte / expired envelope → dead_letter |
| 4 | idempotent crash recovery | §3 fsync ordering, §4 quarantine; recovery **redoes** validated renames | kill -9 mid-tick/mid-delivery; replay recovery twice → no-op |
| 5 | corrupt-tail quarantine | §4 mechanics | truncate/corrupt record → quarantine move + audit, good state resumes |
| 6 | guard-drift fail-closed | §5 schedule row (ADR-0008 seam) | modified guard input → drop+log+alert, never delivered |
| 7 | `same_uid_untrusted` label (security F5a) | §9 | label present in status output and every delivery audit record |
| 8 | admin op via agent socket rejected (security F5b) | §9 admin channel | admin attempt via agent socket → fail-closed rejection + audit |
| 9 | generation-boundary continuity (security F5c) | §ADR-5 policy via lease table | exact-generation message across replacement boundary → dead_letter; stable_mailbox → later authenticated generation delivers |
| 10 | name-reuse isolation (security F5d) | §ADR-5 policy | reused name → new agent_id; no access to predecessor inbox/policy/queue |
| 11 | kill -9 between claim-check and enqueue (formal F2) | §3 write-ahead order | **cycle lost, never duplicated** |
| 12 | offline recipient (formal F3) | §5 attempt accounting | offline 10 min, reconnects ⇒ delivered (or expired), never `attempts_exhausted` |
| 13 | writer-lease restart window (formal F1) | §6 durability/re-claim | daemon restart with live writer session ⇒ no double-writer window; re-claim or normal guard path |
| 14 | late ack after dead_letter (formal F4) | §5 lease table | defined, idempotent terminal state |
| 15 | SIGSTOP recipient (formal F8) | §8 execution model | other deliveries and schedules proceed |

## 12. Non-goals (mirroring ADR Non-actions)

No agent execution in the daemon, no model/provider access, no remote exposure, no extension loading, no automatic startup, no Zellij replacement beyond what coas-pi deprecation (Q-coordinated, post-parallel-run) removes.
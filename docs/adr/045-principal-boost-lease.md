# ADR 045: Principal-approved `/boost` frontier-model lease

## Status

Accepted — 2026-08-19 (independent council PASS at `b1166d4`). T-843 authorizes the minimal host-injected bridge and deterministic test host; live Q/provider enablement remains separately gated by independent PASS and committed contract handoff.

## Context

T-839 requires a non-sticky `/boost` command that permits a Principal-approved Sol Ultra turn without changing root model defaults, residency, schedules, or normal agent state. The design review established five invariants: ADR-035 governance must compose with every dispatch, Sol must never remain selected between human yields, every human-visible terminal response consumes exactly one lease yield, parser subcommands are unambiguous, and only one active lease may exist globally.

The accepted design proposal is `docs/reports/t-839-boost-lease-proposal.md` at `c4a6b75`. This ADR resolves its remaining six integration decisions. It does not authorize an implementation, provider call, or configuration mutation.

```mermaid
sequenceDiagram
  participant P as Principal
  participant L as BoostLeaseAuthority
  participant G as ADR-035 governance
  participant M as Model selector
  P->>L: /boost request
  L->>L: authorize + reserve global budget
  L->>G: classify combined prompt before each activation
  alt public and eligible
    L->>M: select configured Sol lease model for one active turn
    M-->>P: terminal human response
    L->>M: restore captured GLM baseline
  else private/local-only or policy denial
    G-->>L: deny
    L-->>P: bounded denial; no Sol dispatch
  end
```

## Decision

### 1. Principal-only authority and budget

`BoostLeaseAuthority` is a new session-local authority owned by `pi-panopticon`, not a tool-callable capability. It may be entered only from a Principal-authenticated `/boost` command. Agents, schedules, Matrix input, tools, and nested child sessions cannot reserve, inspect sensitive details of, or reset a lease.

The authority owns one global lease slot and an in-memory yield budget. Reservation requires Principal identity, a positive `-n` within the hard maximum of **3**, and an unused global slot. The global slot spans every agent, child session, isolation mode, and nested command: a leased subject cannot delegate or mint a sublease, and any nested `/boost` request denies while the slot is occupied. It re-checks Principal authorization, global-slot availability, and remaining budget at initial reservation and immediately before every later reactivation. Denial consumes neither a yield nor a provider call.

The authority writes a bounded append-only local audit event before activation and after every transition. An audit failure before dispatch denies activation; an audit failure after dispatch forces reversion. Audit records contain opaque lease/subject/issuer ids, timestamps, state transition, requested/consumed yields, isolation mode, model-policy keys, and bounded failure category only. They never contain prompt, response, provider error body, credential, workspace content, or token count.

### 2. Model-policy mapping and governance composition

Implementation must add two explicit `modelRoutingPolicy` identifiers:

- `principalBoostBaseline`: required to resolve to the registered `glm-5.2` identifier.
- `principalBoostLease`: required to resolve to the registered Sol Ultra identifier.

If either identifier is absent, unregistered, or does not match its required family, reservation is denied; there is no substitution, provider probing, or global-default fallback. Adding the identifiers and their values is a separately reviewed configuration action after this ADR is accepted.

At reservation, `BoostLeaseAuthority` captures the live result of `resolveModel` for `principalBoostBaseline`. Immediately before every Sol dispatch it composes the explicit user prompt with the fixed ephemeral framing below and sends that combined text through ADR-035 classification. If private/local-only policy makes the configured Sol lease model ineligible, activation denies fail-closed. The captured baseline is restored verbatim even if live routing policy changes while the lease exists.

### 3. Lease and reversion lifecycle

A lease has `Reserved`, `Active`, `Reverting`, `RevertFailed`, and terminal `Idle` states. Sol is selected only while `Active`; the baseline is restored after every human yield before the lease may return to `Reserved`. The next eligible human turn requires a new governance and budget check before Sol may be selected again.

A yield decrements exactly once when the runtime emits a terminal response available to a human. Collapsed or hidden UI styling still counts when that human can reveal/read the response. Only cancelled, failed, tool-only, or fully suppressed-and-never-yielded work does not decrement. Tool calls, stream chunks, internal reasoning, and retries within one active turn do not decrement.

Any Sol transport failure, cancellation, timeout, policy failure, isolation failure, reset, expiry, restart, or session transfer enters `Reverting`. Reversion is idempotent and must restore the captured baseline before any next dispatch. Any restoration, ephemeral-context disposal, audit-finalization, or lease-cleanup failure enters `RevertFailed`; it blocks **all model dispatch for that subject** (not only boost dispatch), records a bounded failure category, and requires an explicit Principal `reset`. Reset retries baseline restoration and cleanup only; it never replays the prompt or selects Sol. A lease cannot survive restart, transfer, or expiry.

### 4. Grammar and prompt boundary

```ebnf
boost-command = "/boost", ws, (status | reset | request) ;
status        = "status" ;  (* terminal; no trailing tokens *)
reset         = "reset" ;   (* terminal; no trailing tokens *)
request       = { option, ws }, [ "--", ws ], prompt ;
option        = "-n", ws, integer | "--clean" | "--fresh" ;
integer       = "1" | "2" | "3" ;
prompt        = 1*2048UTF8-byte ;
```

`status` and `reset` reject trailing tokens. A prompt beginning with either word must use `--`. Unknown, repeated, non-positive, out-of-range, or mutually exclusive options are rejected before reservation. `--clean` and `--fresh` are mutually exclusive.

The exact ephemeral framing is appended after immutable system and repository policy, immediately before the explicit boost prompt:

```text
[BOOST REVIEW FRAME — EPHEMERAL]
Challenge assumptions. Inspect the underlying diff when available. Avoid repeating recent failed edits.
[/BOOST REVIEW FRAME]
```

The framing and explicit boost prompt are capped together at 2,048 UTF-8 bytes for the caller prompt; neither is written to system prompts, `AGENTS.md`, workspace context, schedules, model defaults, agent profile, audit log, completion transcript, or a later GLM turn.

### 5. Isolation identity binding

`--clean` creates a transient dispatch context containing only immutable policy, repository instructions, the explicit prompt/framing, and the workspace identity resolved at reservation. It excludes conversation history and hidden session state.

`--fresh` creates a new empty transient session bound to the same Principal issuer id and the same resolved workspace identity snapshot. It never inherits prior conversation, changes cwd/workspace, merges content back, or creates a reusable child authority. If the workspace binding cannot be revalidated at activation, dispatch denies and the lease reverts. Both modes retain the normal tool/workspace confinement policy.

### 6. Host bridge and durable recovery

T-843 provides the deployable ownership boundary omitted by the inert slice. A host injects the complete `LiveBoostRuntimeBridge`; normal `ExtensionAPI` loading has no bridge and fails closed. Q access is an exact read-only schema-v2 adapter. Durable reserve/consume/release is WAL-backed and mutex-serialized by enablement under one global lease cap. Active Q revoke or expiry orders `Revoking`, `AbortSignal` abort, terminal acknowledgement, baseline restoration, redacted audit, then budget release.

`RevertFailed` and shutdown recovery markers are durable and per subject. Principal reset revalidates Q control and restores baseline before clearing a marker. Shutdown explicitly chooses awaited restoration or durable blocking; no activation survives restart. T-826 is an external daemon-backed/persistent-session tracker reference, **not a repository-local ADR**; T-843 aligns only with that host-owned session/control direction.

## Consequences

- The external-model route is explicitly Principal-authorized, one-at-a-time, bounded to three human yields, governance-classified, auditable without prompt retention, and non-sticky.
- A failed GLM restoration stops all model dispatch for its subject, favoring a visible safe failure over silent model drift.
- Adding actual model identifiers requires later approved configuration work; this ADR makes no configuration change.
- The bridge remains inert under normal extension loading; live Q/provider deployment remains unavailable until independent review passes and the exact control contract is committed and handed off.

## Required implementation evidence

- Parser tests for terminal subcommands, `--`, option bounds, duplicates, and 2,048-byte boundary.
- State tests for reversion after every yield, no decrement for non-yields, collapsed-but-visible response decrement, expiry/restart/reset, and all-dispatch blocking in `RevertFailed`.
- ADR-035 integration tests for combined-input private classification and fail-closed Sol denial.
- Authority tests for Principal-only access, global slot, reactivation re-check, audit redaction/write failure, and no external call on denial.
- Isolation tests for clean/fresh binding, no history inheritance, no merge, and workspace revalidation failure.
- Regression tests proving no root-model/default/config/scheduler mutation and restoring the captured baseline before each non-boost dispatch.

## Predicted Impact

- **Expected fixes:** prevents sticky frontier selection, private-input provider bypass, ambiguous lease consumption, and un-audited external-model activation.
- **At-risk regressions:** stricter reversion can block a subject after baseline restoration failure; parser caps can reject formerly free-form text. Both are intentional, bounded, and require explicit tests above.

## Related

- ADR-035: workload governance/model routing consumer
- `docs/reports/t-839-boost-lease-proposal.md`
- `planning/T-843-LIVE-BOOST-RUNTIME-BRIDGE-PROPOSAL.md`
- `planning/T-843-LIVE-BOOST-RUNTIME-BRIDGE-IMPLEMENTATION.md`
- T-839 / T-843
- T-826 external tracker reference (host-owned persistence direction only; not an ADR in this repository)

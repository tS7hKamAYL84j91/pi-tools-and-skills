# Proposal: Durable Reviewer Disposition Claim-Checks

## Finding

Completed Navigator/council review runs can lack a retrievable result/artifact even when runtime status says `completed`. Recovering verdicts from agent activity/session logs is non-durable and mixes review evidence with operational diagnostics.

## Bounded proposal

Add a review-disposition claim-check written only after a reviewer produces a terminal disposition. This is distinct from team/runtime status.

```mermaid
flowchart LR
  Run[Reviewer run id] --> Verdict[Terminal verdict + evidence]
  Verdict --> Claim[Immutable claim-check artifact]
  Claim --> Consumer[GM / approval workflow]
  Status[Runtime status] -. operational only .-> Run
```

## Artifact contract

A claim-check contains only:

- reviewer run id and reviewer/team identity;
- verdict: `PASS | REVISE | BLOCK`;
- reviewed commit/ref and bounded changed-path list;
- validation commands and pass/fail summaries;
- bounded findings/recommendations;
- creation timestamp and schema version.

It excludes prompts, model output/transcripts, secrets, credentials, raw provider errors, workspace contents, and runtime process state.

## Rules

- A terminal runtime state alone is never a disposition.
- No claim-check is written for a missing verdict; consumers receive an explicit `review_result_missing` state.
- The review caller receives a stable claim-check id/path, not an inferred activity-log recovery.
- The artifact is append-only/immutable after creation and has bounded size.
- Runtime status remains responsible only for liveness/progress and must not be overloaded with verdict semantics.

## Non-goals

- No reviewer implementation, scheduler, model, provider, or persistence change now.
- No transcript storage or automatic approval/merge.
- No replacement for existing runtime/team status APIs.

## Required design review before implementation

1. Council review of public tool surface, persistence/retention, security/privacy, and failure semantics.
2. Explicit decision on artifact root/ownership, claim-check id format, schema, retention, and access controls.
3. Tool-surface review for a read-only disposition lookup and its missing-result behavior.
4. Tests for terminal verdict persistence, missing verdict, bounded evidence, immutable write, and no secret/transcript leakage.

## Backlog recommendation

Create a separate council-gated ticket: **Durable reviewer-disposition claim-checks**. Do not implement from this proposal without the required design decisions.

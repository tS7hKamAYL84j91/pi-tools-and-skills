# T-886 — Goal reliability and approved augmentation

Kanban T-886 is authoritative for scope, checklist, blockers and evidence. This document is the bounded implementation/review plan, not a parallel backlog.

## Target and constraints

First establish reproducible defects behind the reported phantom goal and competing continuation drivers. Abrupt session-log endings do not prove the proposed process-death mechanism; distinguish reproduced defects from crash hypotheses. Preserve ADR-049 bounded liveness, ADR-051 lineage isolation, trusted completion gates and existing work. No live /goal reproduction, provider calls, session restarts, global settings changes or event-loop activation.

Sources in sibling working-notes: `briefs/2026-09-04-pi-goal-harness-crash-diagnosis.md` and `briefs/2026-09-04-pi-goal-augmentation-spec.md`. The latter remains part of the canonical combined stream; it is not silently delivered by the crash fix.

## Slices and acceptance

1. **Read-only diagnosis plus failing regressions:** inspect current parser, runtime, watchdog, hooks and supported pi SDK APIs. Add deterministic tests using temporary state/fake host boundaries. Report exact commands, baseline failures, current-code locations and smallest fix proposal. Do not implement production changes in this first delegation.
2. **Reliability implementation:** after diagnosis review, fix confirmed parser/continue intent, single-driver/watchdog lifecycle, streaming/session steering, cross-process ownership and asynchronous error containment gaps. Do not add speculative machinery for unreproduced hypotheses. Compatibility changes (including removal of implicit objective syntax) need explicit review, not accidental parser regressions.
3. **Independent integration review:** a different Luna reviewer checks each regression, concurrency/lineage boundaries, cancellation and error behavior. Verify focused tests, npm run check, npm test, diagnostics, secret-safe diff and updated architecture/docs. No fitness exemptions. Commit/push reviewed feature-branch work before recording delivery.
4. **Augmentation design and delivery:** reconcile proposed light mode/promotion, compact markers, exposure gating, cache-budget audit and goal-writer skill with actual current APIs. Upstream tool names and session-state assumptions are design input, not our existing contract. Council/ADR for public-tool/lifecycle/persistence changes; do not bypass gates or change defaults. Keep native per-tool output budgets under T-899. Record each augmentation criterion's outcome before closing the combined ticket, or explicitly approve a linked split.

## Operating plan

Principal explicitly directed GM implementation takeover on 2026-09-05. The builder is stopped; GM owns the final coherent implementation and a different explicit `openai-codex/gpt-5.6-luna` reviewer checks the frozen patch. Current evidence: `docs/reports/t-886-final-validation.md`. Kanban remains authoritative. The existing five-minute repo schedule monitors this stream; no competing /goal or event-loop driver. T-795 then T-888 follow the authorized queue. The reliability candidate now passes full checks/tests; final independent review and pushed evidence are required. Augmentation remains gated and is not completed by reliability delivery.

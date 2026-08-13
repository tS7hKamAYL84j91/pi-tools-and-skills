# Matrix Ingress Resource Bounds

## Goal

Bound Matrix attachment and event-dedup resource use without changing trusted-sender or attachment semantics.

## Constraints

- Native Node APIs only.
- Preserve the existing per-attachment byte limit and error/result shapes.
- Add a small fixed attachment-download concurrency limit, an aggregate in-flight byte reservation, a request deadline, and lifecycle abort.
- Timeline callbacks must not create unbounded detached promises; failures remain normalized through existing ingress error handling.
- Replace unbounded `seenEventIds` with a deterministic bounded recent-ID set/LRU.
- Cache pruning may be added only if bounded and covered; do not introduce a scheduler/service.
- No live homeserver tests; use mocked fetch/adapter events.

## Acceptance criteria

- Tests prove concurrency never exceeds the configured/fixed limit, request timeout/stop aborts reads, aggregate reservations are released on success/failure, and oversized bodies remain rejected.
- Dedup retains recent IDs and evicts the oldest at its bound.
- Existing Matrix config/security/attachment/lifecycle tests continue to pass.
- Focused tests, `npm run check`, `npm test`, and `git diff --check` pass without fitness exceptions.

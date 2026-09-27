# pi-goal implementation intent

## Purpose

`pi-goal` drives one explicitly owned project goal across bounded agent turns.
The persisted goal state is authoritative; Markdown here records why the code
has these boundaries.

## Authority boundaries

- The root agent owns completion requests.
- The operator-configured trusted verifier decides whether completion passes.
- A worker may report progress or a blocker, but cannot complete the goal.
- Numerical checks, filesystem confinement, ownership, and resource gates belong to
  code, not model judgement.

## Safety invariants

1. Only the matching owner token and generation may mutate an active goal.
2. Claims do not expire implicitly; uncertain work is paused for explicit review.
3. Replacement sessions must preserve workspace, goal binding, and session lineage.
4. A failed completion gate pauses the goal rather than treating prose as success.
5. Unknown files and unrelated state survive clear/recovery operations.
6. Liveness diagnostics never infer failure from elapsed time alone.

## Derived checks

The TypeScript tests under `tests/goal/` and the trusted gate command are the
executable confirmation of these invariants. When this document changes, review
those tests for coverage rather than generating tests mechanically.

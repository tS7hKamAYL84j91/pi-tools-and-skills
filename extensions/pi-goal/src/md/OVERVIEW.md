# pi-goal implementation intent

## Purpose

`pi-goal` drives one explicitly owned project goal across bounded agent turns.
The persisted goal state is authoritative; Markdown here records why the code
has these boundaries.

## Authority boundaries

- The root agent owns completion requests.
- Completion executes the workspace-local hook in `.pi/goal/settings.json`.
  Humans and authorized local agents can amend it; it is validation, not an
  independent operator approval. No pre-session environment variable is required.
- A worker may report progress or a blocker, but cannot complete the goal.
- Numerical checks, filesystem confinement, ownership, and resource gates belong to
  code, not model judgement.

## Safety invariants

1. Only the matching owner token and generation may mutate an active goal.
2. Claims do not expire implicitly; uncertain work is paused for explicit review.
3. Replacement sessions must preserve workspace, goal binding, and session lineage.
4. Missing/failed completion hooks leave goals open for local configuration or
   repair, never treat prose as success, and do not prevent explicit start/stop.
   Changed settings invalidate in-flight results; historical terminal receipts
   remain immutable evidence of the configuration used at completion.
5. Unknown files and unrelated state survive clear/recovery operations.
6. Liveness diagnostics never infer failure from elapsed time alone.

## Derived checks

The TypeScript tests under `tests/goal/` and the configured completion hook are the
executable confirmation of these invariants. When this document changes, review
those tests for coverage rather than generating tests mechanically.

# Knowledge Base — Monorepo Extension Refactor

## Findings

- Commit `b1b4b44` passed static/full tests despite its advertised external-agent feature being inert end to end; isolated unit tests did not prove peer resolution or lifecycle integration.
- `MaildirTransport.init()` is a watcher-readiness contract: changing it to validation-only silently prevents fresh-session filesystem watches.
- External identity requires one shared namespace across volatile pi peers and durable external peers; external-only duplicate checks enable spoofing after integration.
- Durable manifest read/modify/write requires higher-level locking even when individual writes are atomic.
- Mailbox path validation must use `path.relative` containment and symlink-safe directory creation, not string prefixes.
- All nine extensions are statically cycle-free and do not import other extensions; `lib/` also preserves inward dependency direction.
- Highest-risk verified defects are cross-process Kanban transactions, team-form/Goal/CoAS path confinement, child-process cancellation, CoAS shutdown/approval semantics, Matrix resource bounds, and Ollama public overrides.
- Knip alone does not prove production reachability when tests and broad configured entries retain future/compatibility modules; a production-entry graph found 1,796 LOC requiring manual obligation verification before deletion.
- Passing leaf tests can miss public orchestration defects: ADR-043, CoAS approval false-return, spawner execution, Matrix SDK adapter, and command wrappers need handler/integration characterization.
- External-agent liveness derives from durable registration rather than the placeholder PID; health checks must bypass PID and stall assessment.
- Kanban `board.log` is a cross-process authority: unlocked append versus atomic replacement can lose events, and compensating claim events can clear a different process's winning claim.

## Decisions

- Workspace-scoped external manifests use `ctx.cwd` consistently at startup and command time.
- External mailboxes remain under a confined persistent root and are retained when registration metadata is removed.
- Runtime external peers are a workspace-loaded snapshot merged by the registry rather than fake PID-backed volatile registry files.
- “Complete refactor” means resolve all verified P0/P1 findings or explicitly escalate them; P2/P3 work is included only when bounded and lower-risk than deferral.
- External `AgentRecord.cwd` is the resolved workspace root; `mailboxPath` remains the transport location and populates the existing health diagnostic-path field.
- Kanban ordinary appends, multi-event read-validation transitions, and compaction share the advisory lock at `board.log.lock`; task Markdown and snapshots remain derived.

## Reusable Code Patterns / API Usage

- Serialize JSON read/modify/write with `withAdvisoryLock(path, async () => { ... })` plus atomic replacement.
- Validate containment with `relative(root, resolved)` and reject empty, absolute, `..`, or `../` results.
- Characterise orchestration ordering in lifecycle tests, not only leaf helpers.
- Avoid nested advisory-lock acquisition by separating the public locked append/transaction APIs from the internal append that requires the board lock.
- Register watcher self-write markers before appending, and roll back newly registered markers if persistence fails.

## Failed Attempts (Anti-Patterns)

- Calling mailbox `init()` for external IDs without adding external records to peer resolution.
- Using different fallback roots for startup and commands.
- Treating a final mailbox path as a base directory and adding `<id>/inbox` twice.
- Encoding a regression in a modified unit test instead of preserving the original readiness contract.
- Verifying a claim after unlocked appends and issuing a compensating `UNCLAIM`; the compensation is not owner-conditional and can clear the concurrent winner.

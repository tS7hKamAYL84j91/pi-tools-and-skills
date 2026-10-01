# Current work

Jim's request: implement simplification proposals 1–4, without changing public
tool/command contracts, live configuration, session history or safety gates.

- [x] Consolidate docs: root navigation, package usage, cross-cutting architecture,
  and ADR history; remove completed checklist narratives.
- [x] Inventory `lib/` production consumers and colocate clearly extension-owned
  helpers without changing their behavior.
- [x] Group Goal/Teams runners in `benchmarks/`; keep offline tests in CI and
  live evaluation explicitly opt-in.
- [x] Replace metric-only architecture gates with boundary-focused checks.
- [x] Run focused and full checks; audit the final tree against all four items.
- [ ] Operator configures the trusted verifier and explicitly resumes Goal for
  final verification. Remove this checklist after verified completion.

The Goal's trusted completion verifier is not configured in this session.
Implementation and local validation passed; verified completion still requires
the operator to configure `PI_GOAL_GATE_COMMAND` and explicitly resume.

Teams behavior refactoring (proposal 5) is outside this request. Kanban mouse
support remains deliberately deferred, not part of this cleanup. Completed
checklists and benchmark outcomes are retained in Git history, not copied here.

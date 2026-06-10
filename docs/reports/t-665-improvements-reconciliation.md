# T-665 Improvements Reconciliation

Status: active

## Source verification

- Ran `git fetch --all --prune` in `/home/jim/git/pi-tools-and-skills`.
- No remote branch named `feature/improvements` exists.
- No `docs/improvements.txt` exists on fetched remote refs.
- Closest source is `origin/feature/main-docs-ux-plan`, which contains:
  - `docs/teams-future-improvements.md`
  - `docs/teams-ux-improvements.md`
  - `docs/archive/teams-future-improvements-progress-log.md`
- Current `main` no longer contains those files because commit `0e83f8d` consolidated active improvement docs into `docs/deep-dives/teams-platform.md`, `docs/deep-dives/ux-tools-policy.md`, and related canonical docs.

## Findings

The closest remote improvements docs are historical or completed:

- `docs/teams-future-improvements.md` says the teams remediation roadmap is complete and future teams-platform work should be evidence-gated.
- `docs/teams-ux-improvements.md` marks UX-001 through UX-004 as done with validation evidence.
- Current `docs/deep-dives/teams-platform.md` keeps the same evidence-gated posture and does not list open implementation tasks.
- Current `docs/deep-dives/ux-tools-policy.md` defines cross-extension UX/tool policy and fitness tests, not an unfinished work queue.

## Ticket proposals

No implementation ticket should be opened directly from the requested missing `docs/improvements.txt`, because the source file/branch cannot be found and the closest improvement docs are closed.

If a human wants follow-up work anyway, these are evidence-gated proposals, not active tickets:

```yaml
- title: Verify a new teams workflow gap before platform changes
  status: proposed-blocked
  source: docs/deep-dives/teams-platform.md evidence-gated future work
  goal: Identify one user-facing workflow that cannot be represented by current v2 manifests, role bindings, prompt refs, limits, and direct handlers.
  acceptance:
    - Concrete workflow and failing/currently-impossible reproduction are documented.
    - Existing team manifest and runtime surfaces are checked first.
    - Implementation is deferred unless the gap is reproducible and user-visible.

- title: Add termwright-backed TUI validation only when tooling is available
  status: proposed-blocked
  source: origin/feature/main-docs-ux-plan:docs/teams-ux-improvements.md
  goal: Replace historical manual TUI checklist evidence with automated terminal captures if termwright is installed and a pi TUI session can be driven headlessly.
  acceptance:
    - Termwright availability and setup are confirmed in this repo.
    - At least one teams overlay capture asserts non-color selection, help text, and narrow-width behavior.
    - The test is stable in CI/local validation or remains documented as manual-only.

- title: Clarify requested improvements source
  status: proposed
  source: human request corr_improvements_txt_tickets
  goal: Get the exact branch, PR, commit, or gist containing the intended `docs/improvements.txt`.
  acceptance:
    - Human provides a concrete ref or URL.
    - The file is fetched and reconciled against current `main`.
    - Only genuinely open items become implementation tickets.
```

## Recommendation

Report this as a no-op/blocker until the human provides the exact branch, commit, PR, or URL for `docs/improvements.txt`. Do not create kanban items from the stale completed teams docs.

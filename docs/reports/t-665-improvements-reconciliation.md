# T-665 Improvements Reconciliation

Status: active

## Corrected source verification

Clarification received after the first pass: the source is not in this repo. It is in `/home/jim/git/working-notes` on `origin/feature/improvements`.

Verified with:

```bash
git -C /home/jim/git/working-notes fetch --all --prune
git -C /home/jim/git/working-notes show origin/feature/improvements:docs/improvements.txt
```

The source file exists and groups requested improvements by extension:

- `pi-doctor` new health-check command: broken extensions, bad YAML, command clashes, missing deps, live-startup-like CI, per-extension fail-soft.
- `pi-panopticon`: restart dead agents, richer per-agent status, shutdown snapshots, digest alerts.
- Teams/council: resumable runs, run manifest, approval UI states, `team_status` phase/child/artifact surface.
- `pi-kanban`: dependencies, `kanban_next`, templates, cleanup suggestions, JSON export.
- `pi-coas`: schedule preview, history log, overlap guard, schedule templates.
- General TUI: searchable lists, grouped errors, confirmations, keyboard help, non-colour markers.
- Security: sandbox paths, trust labels, secret redaction, destructive confirmations.

Gravitas created tickets T-666 through T-672 from this list.

## GM assessment

Recommended ordering balances safety, leverage, and current repo architecture:

1. **T-666 pi-doctor MVP** — highest leverage first. A small diagnostic surface can check existing extension/manifest/command/dependency invariants without changing runtime behavior. It also supports every later ticket by making failures visible and CI-like startup validation reproducible.
2. **T-672 Security hardening** — second, but split narrowly. Secret redaction and destructive confirmations are high value; broad sandbox/trust-label work needs design review because it can affect all extensions and message semantics.
3. **T-668 Teams/council resilience/status** — important because teams are active and recently touched. Start with status/manifest surfaces before resume semantics. Full resumable council runs require architecture review/checkpoint design.
4. **T-670 pi-coas scheduler previews/history/overlap/templates** — good local extension work. Recent CoAS scheduler cleanup makes preview/history/overlap guard a natural follow-up, but it is less cross-cutting than doctor/security.
5. **T-667 Panopticon reliability/status** — valuable but potentially broad. Start with status/snapshot/digest observability before restart/resume behavior.
6. **T-669 Kanban helpers** — useful workflow features, but dependency semantics and `kanban_next` policy can sprawl. Keep behind explicit acceptance criteria.
7. **T-671 General TUI** — implement opportunistically as part of feature tickets unless a specific overlay fails the existing UX policy/fitness tests.

## Recommended first implementation slice

Begin with a **T-666 pi-doctor read-only MVP**.

Scope:

- Add a project extension command/tool surface such as `/pi-doctor` or `pi_doctor` only after checking namespace policy.
- Read-only checks only:
  - extension registration/loadability smoke check using existing setup/registration helpers;
  - built-in slash-command collision check by invoking or sharing `scripts/check-namespace.mjs` behavior;
  - team manifest parse/validation check using existing teams registry validation;
  - package/dependency presence check against `package.json` and installed bins for required dev tools;
  - summarize warnings/errors with stable machine-readable details.
- No auto-fix, no config mutation, no plugin isolation redesign in the first slice.

Reviewer gate:

- Navigator review before implementation for command/tool shape and output contract.
- Council review only if the slice proposes changing extension load semantics or fail-soft behavior.

Validation:

```bash
npm run check
npm test
```

Add targeted unit tests for the doctor result formatter/check aggregation. If a command/tool is added, extend extension-registration and namespace tests as needed.

## Deferred design notes

- **Per-extension fail-soft startup** from T-666 is not MVP; it changes core extension lifecycle semantics and needs design review.
- **Teams resume after API drops** from T-668 needs checkpoint/resume architecture review and should not start as a small patch.
- **Panopticon restart dead agents from where they left off** from T-667 overlaps session persistence and should wait for snapshot/status groundwork.
- **Security sandbox/trust labels** from T-672 are cross-cutting and should be split into narrowly testable hardening patches.

## Recommended human-facing summary

The requested improvements list was found in `working-notes`, not this repo. Gravitas' T-666..T-672 ticket split matches the source. Start with a read-only `pi-doctor` MVP because it is low-risk, cross-cutting, and creates validation leverage for the rest. Do not begin broad runtime/resume/security semantics without explicit review approval.

# T-494 Clean Architecture / KISS / YAGNI / DRY Review

Date: 2026-05-22
Range reviewed: `f9ab2f3..0613eb5`

## Recommendation

**PASS with follow-up cleanup tickets.** Current production code remains safe enough to keep: no default hooks, no network/export path, explicit local config gates, and tests/checks pass. The main issues are maintainability and YAGNI debt in the session-spooling POC chain, not release-blocking correctness defects.

## Checks

- `git log --oneline f9ab2f3..HEAD`
- `git diff --stat f9ab2f3..HEAD`
- Inspected production files under `lib/`, `scripts/`, and `extensions/pi-panopticon/teams/` changed in the range.
- `npm run check` — PASS.

## Findings

| Severity | Principle | Files / refs | Evidence | Recommendation | Follow-up |
|---|---|---|---|---|---|
| High | DRY / Clean Architecture | `lib/session-hook-installer.ts`, `scripts/session-spool-hook.mjs` (`28b6cd3`) | The JS script duplicates validation, manifest shape, path containment, retention bounds, and install/status/uninstall logic from the TypeScript library. Future policy fixes can drift between CLI and library. | Replace duplicated script logic with a TS/compiled-library entrypoint or generate one CLI from the library. Until packaging is decided, keep the script but treat it as POC-only. | T-494A: consolidate session hook CLI logic behind one library implementation. |
| Medium | KISS / YAGNI | `lib/session-spool-runner.ts` (`80df639`) | `pruneSessionFiles()` built an unused `keepFiles` set and looped over synthetic `session-N.jsonl` names, while current writer only emits `session.jsonl`. Return value could report many pruned files even when none existed. | Simplify pruning to actual files written today, or defer rotated-file pruning until rotation exists. | Addressed by T-496: speculative rotated-session pruning removed; `prunedFiles` is now `0` until real rotation exists. |
| Medium | Clean Architecture | `lib/session-spool-runner.ts`, `lib/session-spool.ts` | Runner called `spoolSessionEntries()` which wrote output, then immediately read and atomically rewrote the same session file. Atomicity was attempted at the wrong layer; registry JSON remained non-atomic. | Move atomic write behavior into `spoolSessionEntries()` or remove the redundant rewrite and document best-effort fixture semantics. | Addressed by T-497: output files are individually temp-file+rename atomic; no multi-file transaction is claimed. |
| Medium | YAGNI / API clarity | `extensions/pi-panopticon/teams/approval-gates.ts`, `extensions/pi-panopticon/teams/team-types.ts` (`ffe80b0`, `0613eb5`) | Approval primitives and `TeamApprovalConfig` are not wired into runtime team execution. This is intentional, but the production exports can look like supported runtime policy. | Keep docs explicit that this is provisional. Before any runtime use, add ADR or promote the schema with a concrete team workflow. | T-494D: promote or quarantine approval-gate API when first real workflow is approved. |
| Medium | Clean Architecture / contract clarity | `extensions/pi-panopticon/teams/observability.ts` (`084f40a`) | Observability schema is exported from production code but ADR-deferred. It maps existing details cleanly, but could be mistaken for a durable external contract. | Keep it internal/provisional until a read-only artifact/tool is approved. Add ADR before public API or durable persistence. | T-494E: add ADR if observability JSONL becomes user/tool-facing. |
| Low | DRY | `lib/session-journal.ts`, `lib/session-spool.ts`, `lib/session-log.ts` | There are now three session event representations: raw session-log reader events, redacted journal events, and spooled session JSONL. Boundaries are documented, but conversion semantics are spread across files. | Accept for POC; if used beyond POC, introduce a small shared session event contract or adapter tests to prevent drift. | T-494F: add adapter contract tests before next promotion. |
| Low | KISS | `lib/session-spool-runner-cli.ts` | CLI requires `npx tsx lib/...` instead of an installed binary. This is acceptable for explicit POC use but not polished UX. | No action until real harness lifecycle is approved. | No-go now; revisit only with real hook integration approval. |
| Low | Safety fit | Session-spooling chain docs/ADR | Safety posture is consistent: explicit registry dir, manifest gate, no default hook, redacted Panopticon output, local-private input allowed only locally. | Maintain this posture. Do not add default enablement without ADR/review. | None. |
| Low | Config validation | `extensions/pi-panopticon/teams/team-manifest.ts` (`0613eb5`) | `provider/model` syntax validation improves clarity but is intentionally shallow and cannot detect runtime provider availability. | Good enough; avoid adding provider discovery at config time unless a real user failure pattern emerges. | No-go for provider discovery now. |

## Clean Architecture assessment

The recent code generally keeps policy and mechanism separated:

- Session privacy/activation policy is documented in ADR 017 and reports, while libraries remain explicit and local.
- pi-teams approval and observability primitives consume existing `TeamRunEvent`/`TeamStateManager` boundaries instead of scraping rendered output.
- Config validation remains at manifest boundaries and does not reach into provider runtime discovery.

Main architectural smell: the session-spooling CLI script duplicates the library policy boundary, creating two sources of truth.

## KISS assessment

Most slices are intentionally small POCs. The exception is runner pruning/atomic rewrite behavior, which adds complexity for future rotation semantics not yet implemented.

## YAGNI assessment

Speculative risk is present but contained:

- approval gates and observability are production exports before runtime integration;
- session hook installer/runner/CLI are explicit POCs with docs and no default enablement;
- rotated pruning and manifest lifecycle are ahead of actual hook lifecycle.

No speculative feature currently enables unsafe behavior by default.

## DRY assessment

The largest DRY issue is duplicated hook installer CLI logic. Secondary duplication is conceptual: session event shapes are converted across several files. This is acceptable for POCs but should be consolidated before promotion.

## Safety/control fit

PASS. The reviewed code preserves the intended safety posture:

- no default hooks;
- explicit absolute registry dirs;
- local private input allowed only as local input;
- redacted/bounded Panopticon output;
- no external providers/network export;
- approval gates default-disabled and not globally mandatory.

## Recurrence recommendation

Make this review recurring, but lightweight:

- **Cadence:** monthly, or after any batch of 5+ production-code commits touching `lib/`, `extensions/`, or `scripts/`.
- **Trigger/scope:** review the diff since the previous review tag/report; focus on Clean Architecture, KISS, YAGNI, DRY, and safety/control posture for newly added production code.
- **Mechanism:** use a **kanban template** plus repo-level checklist first. Do not create a CoAS schedule yet; a schedule is useful only after the checklist stabilizes and the team wants automated reminders.
- **Checklist location suggestion:** future follow-up may add `docs/checklists/code-principles-review.md` and a kanban template task titled “Clean Architecture/KISS/YAGNI/DRY review”.
- **No implementation in T-494:** this report records the recommendation only; no schedule/config was added.

## ADR recommendations

No new ADR is required for this review-only artifact. ADR recommendations:

1. Update or create an ADR before promoting `TeamObservabilityEvent` as a durable/public schema.
2. Update ADR 017 before any default hook, real background hook, unredacted output mode, cross-agent unredacted exposure, or persistent retention store.
3. Add an approval-gate ADR before making T-308 gates mandatory in team runtime or mutating tool authorization.

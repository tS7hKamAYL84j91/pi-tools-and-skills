# Progress Log

## 2026-07-24 — /swarm implementation authorized

- **Action**: Principal signed off ADR-036 (`1a388e1`). Hard dependencies ADR-035 (`3163d1a`) and ADR-0008/T-791 (`6bfcaa8`) are landed; #46 merged (`afbf2b7`).
- **Action**: Drafted implementation plan at `planning/SWARM.md`.
- **Action**: Spawned `swarm-builder` agent to implement the plan under GM oversight.
- **Next**: Monitor worker progress, validate phases, integrate, and run `npm run check` / `npm test`.

## 2026-07-12 — Fusion live recovery

- **Action**: Ran 10 Balanced and 10 Fast live Fusion benchmarks after explicit authorization.
- **Result**: Fast improved median by 31.9% and P95 by 56.4%, but failed the median gate and every run was degraded; Codex panel/judge nodes failed 10/10 and Balanced Gemini 2.5 passed only 3/10.
- **Action**: Reproduced a retained diagnostic run without recording prompts or provider output.
- **Result**: `openai-codex/gpt-5.5` works standalone, but the team provider override sends unsupported `max_output_tokens`; the live harness also misclassifies structured degraded fallback JSON as valid.
- **Action**: Council reviewed the repair strategy; wrote `planning/FUSION_RECOVERY.md`; delegated isolated provider-payload and benchmark-truthfulness patches to Jules sessions `3008121552037342351` and `4704459073431526928`.
- **Next**: Review/integrate delegated patches, diagnose Gemini 2.5 with truthful error categories, validate, review, and rerun live promotion gates.

## 2026-07-12

- **Action**: Audited the team TUI, Fusion handler, Navigator handler, session mode, model runner, prompts, progress widget, and team browser.
- **Result**: Identified the primary latency levers as model choice, output/context bounds, and avoidable sequential synthesis; identified TUI issues in parallel-node reporting, cancellation friction, and synchronous registry loading in a render closure.
- **Action**: Consulted `llm-council` on the prioritized Fusion/TUI improvement strategy.
- **Result**: Council supported bounded panel/judge output, profile-based fanout, event-driven progress, low-friction cancellation, and render-path caching; it advised against persistent workers and speculative judging.
- **Action**: Wrote `planning/PLAN.md` covering shared profiles, Fusion and Navigator optimization, TUI changes, benchmarks, tests, risks, and rollout gates.
- **Result**: Planning complete; implementation has not started.
- **Next**: Approve Phase 0 benchmark methodology and the shared profile contract before code changes.
- **Action**: Activated the implementation goal and refined `.pi/goal/TODO.md` into concrete protocol, TUI, benchmark, documentation, and validation tasks.
- **Action**: Delegated the shared profile/Fusion/Navigator core slice to `core-speed-implementer` in an isolated worktree and the team-overlay render-path slice to `overlay-ux-implementer`; delegated runtime progress/cancellation design to `runtime-ux-designer`.
- **Result**: Implementation is in progress with isolated ownership; root retains integration and final validation responsibility.
- **Next**: Review and integrate delegated commits, then delegate the runtime progress/cancellation patch against the integrated base.
- **Action**: Integrated delegated commits for render-path safety (`3d9a8c5`), speed profiles/Fusion/Navigator (`f3f1cd5`), provider/direct-result contracts (`db660cb`), event-driven progress/cancellation (`a2a5348`), one-shot Profile/Run UI (`d50b120`), and deterministic/live evaluation harness (`2de8fd9`).
- **Action**: Added root integration refinements for direct custom-message display and compact widgets (`1e4ca6b`), plus semantic prompt truncation and the strict Navigator Fast response contract (`0190bb7`).
- **Result**: `npm run check` passed with 99.19% type coverage; `npm test` passed 116 files/936 tests; `npm run test:evals` passed 13 tests; the live benchmark opt-in guard and script syntax check passed.
- **Result**: No live provider benchmarks were run. Balanced remains default until the documented Fusion and Navigator gates pass.
- **Next**: Resolve focused Navigator/council review findings, finalize trackers, and complete the goal audit.
- **Action**: Focused Navigator review returned REVISE for missing Navigator abort propagation, Fusion model/binding detachment after provider-diverse reordering, and insufficient live benchmark route validation.
- **Result**: Added abort propagation/test, stable panel source indexes/test, and exactly-one matching run validation; Navigator re-review returned PASS.
- **Action**: Final `llm-council` review returned PASS and recommended a non-empty degraded Fusion answer plus explicit provider-diversity configuration documentation.
- **Result**: Both council follow-ups were applied.
- **Action**: Full validation exposed the Fusion handler hotspot fitness gate. Delegated and integrated a no-exemption split into `team-fusion-planner.ts` and `team-fusion-output.ts` (`8c6c22f`), reducing the handler from 289 to 157 lines and complexity from 128 to 80.
- **Next**: Run final integrated validation, commit durable trackers, and complete the goal audit.
- **Result**: Final integrated validation passed: `npm run check` (99.19% type coverage), `npm test` (116 files/937 tests), `npm run test:evals` (3 files/13 tests), benchmark syntax and opt-in guard, and `git diff --check`.
- **Result**: Completion audit accounted for every plan item. Live provider measurement remains explicitly opt-in; Balanced stays default. Generic reasoning-effort normalization and extra prompt/render caching remain deferred because safe provider shapes/performance evidence are absent.
- **Next**: Mark the active goal complete with repository and validation evidence.

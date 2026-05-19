# Teams Platform

Living summary for `extensions/pi-teams`.

## Current architecture

```mermaid
flowchart TD
  User[User or agent] --> Tools[team_* tools and commands]
  Tools --> Registry[Team registry\nbuilt-in/user/project manifests]
  Tools --> Runtime[Team runtime]

  Registry --> Manifests[v2 team manifests\nprotocol, roles, prompts, models, limits]
  Registry --> Subagents[Subagent descriptors]
  Registry --> Prompts[Protocol prompt assets]

  Runtime --> Handler[TeamHandler boundary]
  Handler --> Council[Direct council handler\nconsult/debate]
  Handler --> Research[Direct research handler\nExplorer/Verifier feedback loops]

  Council --> ModelNode[Model-backed role call]
  Research --> ModelNode
  Council --> LiveNode[agent:<name> live-agent call]
  Research --> LiveNode
  Handler --> State[pi session custom run events]

  State --> Inspect[team_describe / overlay inspection]
```

## Standing decisions

- Keep execution config (`tools`, provider parameters, models) separate from
  runtime data rendered into protocol templates.
- Resolve prompts by protocol-local slots with deterministic precedence:
  protocol default < subagent prompt < team prompt override < binding
  override < binding literal.
- Persist team run state in the Pi session tree as protocol-neutral custom events.
- Accept only strict v2 authored team manifests; do not add v1 or legacy
  compatibility aliases.
- Keep direct topology functions per protocol; do not reintroduce a generic DAG
  executor unless a concrete user-visible workflow cannot be implemented as a
  small direct handler. The `research` protocol is implemented as a bounded
  direct handler, not a generic graph runtime.
- Keep bundled protocol labels (`debate`, `consult`, `research`) as
  configuration vocabulary, not TypeScript architecture boundaries.
- Represent live peers explicitly as `agent:<registered-name>` role bindings.

## Research protocol

`deep-research` uses protocol `research`, a bounded direct loop:

```text
Explorer -> Verifier/EAM + Gap Detector -> targeted Explorer follow-up -> Synthesis
```

- `limits.maxLoops` controls Explorer/Verifier feedback loops. Default is 2;
  runtime overrides are capped at 5.
- Verifier output containing `VERIFIED_COMPLETE` stops loop iteration early.
- Run progress is persisted through existing session custom events and surfaced
  via `team_runs`.
- `team_stop` records a stop/failure request in session state. It is a smallest
  safe control surface; already-running child model calls still stop only at
  normal cancellation/runtime boundaries.

## Evidence-gated future work

Only consider new teams-platform work when one of these is true:

1. A user-facing workflow cannot be represented with current v2 manifests, role
   bindings, prompt refs, limits, and direct protocol handlers.
2. A fitness function or validation test exposes a recurring architecture smell.
3. Operational needs require richer live-agent lifecycle control or durable state
   that cannot fit the current session event model.

## Completed work

| Item | Status | Ref |
|------|--------|-----|
| Direct council handler (`consult`/`debate`) | ✅ Done | `team-handlers.ts` |
| Delete DAG executor (`team-graph.ts`) | ✅ Done | arch tests |
| Delete lowering layer (`team-lowering.ts`) | ✅ Done | arch tests |
| Delete protocol contracts (`protocol-contracts.ts`) | ✅ Done | — |
| Simplify `team-types.ts` (remove graph schema) | ✅ Done | registry tests |
| Migrate prompt contracts into handlers | ✅ Done | prompt-chain tests |
| Extract `team-node-runner.ts` shared helpers | ✅ Done | unit tests |
| Remove pair-coding topology | ✅ Done | `11436c9` |
| Rename default-debate → llm-council | ✅ Done | `11436c9` |
| Rename consult → navigator | ✅ Done | `f5a8ad3` |
| Supersede graph-affordances docs | ✅ Done | archive |

Historical planning records are in git history:
`git log --all --oneline -- docs/archive/teams-simplification.md`
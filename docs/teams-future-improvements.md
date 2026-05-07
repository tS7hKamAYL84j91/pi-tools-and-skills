# Teams Future Improvements

Living summary for `extensions/pi-teams`. Historical implementation plans and progress logs are in git history (`git log --all --oneline -- docs/archive/`).

## Current status

The teams remediation roadmap is complete, and the graph-executor expansion plan is superseded by `docs/teams-simplification.md`.

No broad protocol extraction, LangGraph migration, generic DAG executor, or compatibility work is currently planned. Reopen only for a concrete user-visible gap, failing fitness function, or simplification that deletes more code than it adds.

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
  Handler --> Pair[Direct pair-coding handler]

  Council --> ModelNode[Model-backed role call]
  Pair --> ModelNode
  Council --> LiveNode[agent:<name> live-agent call]
  Pair --> LiveNode
  Handler --> State[pi session custom run events]

  State --> Inspect[team_describe / overlay inspection]
```

## Standing decisions

- Keep execution config (`tools`, provider parameters, models) separate from runtime data rendered into protocol templates.
- Resolve prompts by protocol-local slots with deterministic precedence: protocol default < subagent prompt < team prompt override < binding override < binding literal.
- Persist team run state in the Pi session tree as protocol-neutral custom events.
- Accept only strict v2 authored team manifests; do not add v1 or legacy compatibility aliases.
- Keep direct topology functions per protocol; do not reintroduce a generic DAG executor unless a concrete user-visible workflow cannot be implemented as a small direct handler.
- Keep bundled protocol labels (`debate`, `consult`, `pair-coding`) as configuration vocabulary, not TypeScript architecture boundaries.
- Represent live peers explicitly as `agent:<registered-name>` role bindings.
- Do not add an external graph/workflow framework unless a future spike proves it deletes meaningful code without hiding Pi-specific behavior.

## Evidence-gated future work

Only consider new teams-platform work when one of these is true:

1. A user-facing workflow cannot be represented with current v2 manifests, role bindings, prompt refs, limits, and direct protocol handlers.
2. A fitness function or validation test exposes a recurring architecture smell.
3. A proposed dependency or abstraction demonstrably removes more code and risk than it adds.
4. Operational needs require richer live-agent lifecycle control or durable state that cannot fit the current session event model.

## Historical records

See `git log --all --oneline -- docs/archive/` for completed planning records, mini-specs, review notes, and the previous long progress log.

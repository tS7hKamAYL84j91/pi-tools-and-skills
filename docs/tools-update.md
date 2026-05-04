# Tools and Commands Namespace Update

Brief for keeping `pi-tools-and-skills` tools, slash commands, prompt commands, and built-in pi commands coherent. This focuses on command/tool naming, overlap risk, and user-facing semantics rather than implementation changes.

## Goal

Make pi-tools command and tool surfaces predictable for humans and models, especially where extension commands overlap semantically with built-in pi commands.

## Scope

In scope:

- Built-in pi interactive slash commands.
- `pi-tools-and-skills` extension slash commands.
- `pi-tools-and-skills` model-facing tools.
- Prompt-template slash commands supplied by this package.
- Command/tool naming patterns, collision policy, and documentation gaps.

Out of scope:

- Changing pi core command resolution.
- Changing task, team, agent, CoAS, Matrix, or Kanban runtime semantics.
- Renaming most commands without a compatibility plan. Exception: `/alias` is now considered redundant with built-in `/name` and should be removed directly.
- Auditing unrelated user-installed packages except where runtime evidence affects namespace visibility.

## Constraints

- KISS/YAGNI: prefer using existing pi concepts over introducing parallel command names.
- Built-in pi slash commands are interactive-only and are not returned by RPC `get_commands`.
- Extension/prompt/skill commands share the slash-command autocomplete surface with built-ins in interactive mode.
- Existing user muscle memory and scripts matter, but `/alias` duplicates and broadens built-in `/name` enough that direct removal is preferred over long deprecation.

## Discovery Surfaces

Pi has three distinct surfaces that users and agents can confuse:

1. **Built-in interactive slash commands** — handled by pi core in interactive mode, e.g. `/name`, `/model`, `/tree`.
2. **Extension/prompt/skill slash commands** — registered by extensions or resources, e.g. `/teams`, `/commit-and-push`.
3. **Model-facing tools** — callable by the LLM, e.g. `set_alias`, `team_run`, `kanban_create`.

Important runtime behavior:

- RPC `get_commands` returns extension, prompt, and skill commands, but not built-in TUI commands.
- Pi autocomplete filters extension commands whose base name conflicts with built-ins and reports diagnostics; conflicting extension commands may be available under an invocation suffix.
- Exact command collision is therefore partially mitigated by pi, but semantic overlap still needs project policy.

## Inventory

### Built-in pi slash commands

Source: pi docs plus `dist/core/slash-commands.js` in the installed pi package.

| Command              | Purpose                                 |
| -------------------- | --------------------------------------- |
| `/settings`          | Open settings menu                      |
| `/model`             | Select model                            |
| `/scoped-models`     | Configure Ctrl+P scoped model cycling   |
| `/export`            | Export session                          |
| `/import`            | Import and resume a JSONL session       |
| `/share`             | Share session                           |
| `/copy`              | Copy last assistant message             |
| `/name`              | Set session display name                |
| `/session`           | Show session info/stats                 |
| `/changelog`         | Show changelog entries                  |
| `/hotkeys`           | Show keyboard shortcuts                 |
| `/fork`              | Create a fork from a prior user message |
| `/clone`             | Duplicate current active branch         |
| `/tree`              | Navigate the session tree               |
| `/login` / `/logout` | Manage provider authentication          |
| `/new`               | Start a new session                     |
| `/compact`           | Manually compact context                |
| `/resume`            | Resume another session                  |
| `/reload`            | Reload resources                        |
| `/quit`              | Quit pi                                 |

Note: one pi docs usage table omits `/import`, but the installed source includes it. Treat source/runtime inventory as authoritative for audits.

### pi-tools extension slash commands

Runtime `get_commands` plus code scan found these pi-tools extension commands:

| Command                | Extension  | Purpose                             |
| ---------------------- | ---------- | ----------------------------------- |
| `/kanban`              | Kanban     | Open Kanban overlay                 |
| `/matrix`              | Matrix     | Show Matrix status                  |
| `/coas-status`         | CoAS       | Show CoAS status                    |
| `/coas-doctor`         | CoAS       | Run CoAS diagnostics                |
| `/coas-workspaces`     | CoAS       | List CoAS workspaces                |
| `/coas-schedules`      | CoAS       | List CoAS schedules                 |
| `/coas-cron-install`   | CoAS       | Explain disabled cron install       |
| `/coas-cron-uninstall` | CoAS       | Explain disabled cron uninstall     |
| `/send`                | Panopticon | Send message to a named agent       |
| `/alias`               | Panopticon | Set session alias and registry name — **remove; use built-in `/name` plus registry sync** |
| `/agent-list-mode`     | Panopticon | Choose list/widget visibility mode  |
| `/agents-mode`         | Panopticon | Set list/widget visibility mode     |
| `/agents`              | Panopticon | Open agent overlay/status           |
| `/teams`               | Teams      | Browse, manage, and run teams       |

Prompt-template commands from this package:

| Command            | Purpose                         |
| ------------------ | ------------------------------- |
| `/commit-and-push` | Stage, commit, and push changes |
| `/refactor`        | Refactor prompt workflow        |

### pi-tools model-facing tool stems

| Stem                  | Examples                                                              | Pattern                                                  |
| --------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `kanban_*`            | `kanban_create`, `kanban_claim`, `kanban_snapshot`                    | Domain toolset with `/kanban` human overlay              |
| `coas_*`              | `coas_status`, `coas_workspace_read`, `coas_schedule_add`             | Tool equivalents for CoAS commands plus extra automation |
| `agent_*` / spawn RPC | `agent_send`, `agent_peek`, `agent_status`, `spawn_agent`, `rpc_send` | Model-facing panopticon orchestration                    |
| alias                 | `get_alias`, `set_alias`                                              | Model-facing identity controls                           |
| `team_*`              | `team_list`, `team_describe`, `team_run`, `team_form`                 | Model-facing team workflows                              |
| messaging             | `message_read`, `message_send`                                        | Cross-channel messaging                                  |

Pi's core model-facing tools are `read`, `bash`, `edit`, `write`. (`grep`/`find`/`ls` are subsumed by `bash`.) No pi-tools model-facing tools collide with those built-ins.

## Status

| Issue                                        | Decision                         | Implementation                 | Validation                                                     | Status |
| -------------------------------------------- | -------------------------------- | ------------------------------ | -------------------------------------------------------------- | ------ |
| TCU-001 exact built-in command collision     | Prohibit                         | No current pi-tools collisions | Code scan + runtime inventory                                  | Pass   |
| TCU-002 `/name` vs `/alias` semantic overlap | Remove `/alias`; add `set_name`; sync registry via heartbeat | Phase 1 implemented: `/alias` removed, `set_name`/`get_name` added, deprecated alias wrappers retained, registry heartbeat sync added | ADR-002/004/005 accepted; council resolved RQ-1/2/3 | In Progress |
| TCU-003 command/tool naming policy           | Document patterns (kebab-case slashes, snake_case tools, noun stems) | Naming policy documented in this brief and linked from `docs/README.md` | Inventory shows valid patterns; future extension docs should cross-link as they change | Pass |
| TCU-004 namespace audit                      | Add scripted check using `builtins.json` manifest | `scripts/builtins.json`, `scripts/check-namespace.mjs`, and `npm run check:namespace` added; folded into `npm run check` | Script fails exact built-in collisions and warns on semantic keywords | Pass |
| TCU-005 docs/runtime inventory drift         | Prefer source/runtime inventory  | Ongoing                        | `/import` docs discrepancy found                               | Open |

## Findings

### TCU-001 — No exact pi-tools collision with built-in slash commands

**Observation:** None of the pi-tools extension commands exactly match built-in pi slash commands.

**Evidence:** Compared built-ins from pi source/runtime with pi-tools commands from code scan and RPC `get_commands`.

**Implication:** There is no immediate command shadowing bug in pi-tools. Future commands should still be checked against pi's built-in list because pi can add commands over time.

### TCU-002 — `/name` and `/alias` overlap semantically

**Observation:** Built-in `/name <name>` sets the pi session display name. pi-tools `/alias <name>` calls both:

- `pi.setSessionName(alias)`
- `registry.setName(alias)`

The model-facing `set_alias` tool has the same broader behavior.

**Risk:** Users who know `/name` may interpret `/alias` as another session-label command, but `/alias` also changes panopticon registry identity and therefore peer discovery/messaging names.

**Desired outcome:** Remove the parallel human command. Built-in `/name` should be the canonical human way to name the current pi session and, by extension, the Panopticon registry identity.

**Candidate acceptance criteria:**

- Remove the `/alias` slash command registration.
- Panopticon registry name derives from the pi session name when one is set.
- Built-in `/name <name>` updates the registry name without requiring a separate `/alias` command.
- If no session name exists, registry naming keeps the current fallback behavior: spawned-agent requested name, cwd basename, then unique suffix.
- Keep a model-facing tool only if needed for non-interactive/RPC workflows; if retained, rename or clarify it as session/agent naming rather than “alias”.

### TCU-003 — Command/tool pairings are useful but undocumented

**Observation:** pi-tools uses several command/tool patterns:

- Human overlay command plus model toolset: `/kanban` + `kanban_*`.
- Human command plus similarly named tool: `/coas-status` + `coas_status`.
- Human command for convenience plus model tools for orchestration: `/send` + `agent_send`/`message_send`.
- Human command plus model workflow tools: `/teams` + `team_*`.

**Risk:** Without a policy, future commands may drift into ambiguous names or accidental overlaps.

**Desired outcome:** Document allowed patterns so new extensions choose names consistently.

### TCU-004 — Namespace audit should be automated

**Observation:** Manual scans found no exact collisions, but upstream pi can add built-ins and packages can add prompts/commands.

**Desired outcome:** Add a lightweight audit script/check that protects against exact collisions and warns on known semantic overlaps.

**Candidate acceptance criteria:**

- Use the checked-in `scripts/builtins.json` manifest, updated from `@mariozechner/pi-coding-agent/dist/core/slash-commands.js` or a stable API when pi is upgraded.
- Extract pi-tools extension commands and prompt names from this repo.
- Fail on exact collisions with built-ins.
- Warn on semantic overlap keywords: `name`, `alias`, `identity`, `session`, `send`, `agent`, `team`.
- Include prompt-template commands in the same slash namespace audit.

### TCU-005 — Built-in docs can lag runtime/source inventory

**Observation:** Installed source includes `/import`; one usage table omitted it.

**Risk:** Docs-only audits can miss built-ins.

**Desired outcome:** Use source/runtime command inventory for collision checks. Treat docs as user-facing context, not as the authoritative command list.

## ADR Log

### ADR-001 — Built-in command names are reserved

**Status:** Accepted

**Decision:** pi-tools extension and prompt commands must not use exact built-in pi command names.

**Consequences:** Prevents autocomplete filtering/suffix surprises and keeps built-in mental models intact.

### ADR-002 — Built-in `/name` is the canonical human identity command

**Status:** Accepted

**Decision:** Remove the pi-tools `/alias` slash command. Panopticon should derive the registry name from pi's session name when available, so built-in `/name <name>` becomes the single human-facing command for naming the current agent/session.

**Consequences:** Eliminates the `/name` vs `/alias` split instead of documenting around it. This is a deliberate compatibility break for `/alias`, accepted because the command duplicates and broadens a built-in concept. Model-facing naming still needs a tool for non-interactive flows — see ADR-004.

### ADR-003 — Command/tool names should share stems where it helps, not force one-to-one parity

**Status:** Accepted

**Decision:** Allow patterns like `/kanban` + `kanban_*` and `/teams` + `team_*`. Require descriptions to state whether a slash command is a human UI command, a model-facing tool equivalent, or both.

**Consequences:** Avoids awkward command proliferation while keeping discovery predictable.

### ADR-004 — Programmatic naming tool replaces `set_alias`

**Status:** Accepted

**Decision:** Add `set_name` as the canonical programmatic naming tool. `set_alias` becomes a deprecated compatibility wrapper that forwards to `set_name`. After a two-release deprecation window, remove `set_alias` entirely.

**Consequences:** Models and RPC callers retain programmatic naming capability. Terminology aligns with built-in `/name`. The deprecation window prevents hard breakage for existing callers.

### ADR-005 — `/name` overrides spawn name; spawn identity preserved in metadata

**Status:** Accepted

**Decision:** When a user sets `/name` or a caller invokes `set_name`, the new name becomes the active display and registry name. The original spawn name is preserved as immutable `spawn_name` metadata. Orchestration should route by stable agent/session IDs or by `spawn_name`/`role`, never by mutable display name.

**Consequences:** Eliminates split-brain identity where the UI says one name and the registry another. Spawn identity is not lost — it moves to a metadata field. Clears the way for `/name` to be the single source of truth for current identity.

## Resolved Questions

Council debate held 2026-05-04 via `default-debate`. All three primary questions resolved.

### RQ-1 — How should Panopticon detect `/name` changes?

**Answer:** Heartbeat-time reconciliation via `pi.getSessionName()`.

- On each Panopticon heartbeat, call `pi.getSessionName()`.
- Compare against the last synced name.
- If changed and valid, update the registry name.
- If unavailable, empty, or errored, preserve the current registry name — do not blank it.
- This is self-healing: a missed check is corrected on the next heartbeat.
- Do not introduce a new lifecycle hook or extension event solely for name sync.
- If a stable `sessionNameChanged` event already exists in pi, subscribe to it for lower-latency updates, but keep heartbeat reconciliation as the fallback.

**Caveats:**
- Requires `pi.getSessionName()` to be cheap and synchronous or near-synchronous.
- Heartbeat latency (≤10s) is acceptable for name propagation; >30s may feel stale.

### RQ-2 — Should `set_alias` be removed at the same time as `/alias`?

**Answer:** No. Remove `/alias` immediately but keep programmatic naming via a new `set_name` tool with `set_alias` as a deprecated wrapper.

- Add `set_name(name)` as the canonical programmatic tool. It sets the built-in session display name; Panopticon syncs the registry from it via heartbeat.
- `set_alias` becomes a deprecated forwarding wrapper to `set_name`.
- `get_alias` becomes `get_name`, reporting both session name and registry name.
- Deprecation window: two releases / sprints, then `set_alias` is removed.
- During transition, `set_name` / `set_alias` may dual-write (set session name + update registry directly) if immediate consistency is needed before heartbeat fires.

**Rationale:** Models and RPC callers cannot invoke interactive `/name`. Removing `set_alias` with no replacement creates a functional regression. Renaming preserves programmatic capability while aligning terminology.

### RQ-3 — Should `/name` override a spawn name?

**Answer:** Yes. `/name` and `set_name` override the active display/registry name. The spawn name is preserved as metadata.

- Name precedence: (1) explicit user/programmatic name from `/name` or `set_name`, (2) spawn-provided name, (3) generated fallback.
- If `/name` is cleared, revert to spawn name or generated fallback, not an empty identity.
- Spawn metadata schema: `{ id, name, spawn_name, role?, name_source? }` where `name_source` is `spawn | user | programmatic | generated`.
- Orchestration routing must use stable IDs or `spawn_name`/`role`, never the mutable `name`.
- If two agents receive the same `/name`, disambiguate by stable ID in the registry.

## Recommendations

1. **Remove `/alias` and make `/name` drive Panopticon identity.**
   - Delete the `/alias` command registration.
   - Sync `registry.name` from `pi.getSessionName()` on each Panopticon heartbeat (RQ-1).
   - Preserve registry name on getter error or empty value.
   - Use the current fallback naming only when there is no session name.
   - Update docs/help to say: use built-in `/name <name>` to name this session/agent for Panopticon.

2. **Add `set_name` as the canonical programmatic naming tool; deprecate `set_alias`.**
   - Add `set_name(name)` tool that sets the built-in session display name.
   - `set_alias` becomes a deprecated forwarding wrapper; remove after two releases.
   - `get_alias` becomes `get_name`, reporting session name and registry name.
   - During transition, dual-write session name + registry if immediate consistency is needed (RQ-2).

3. **`/name` overrides spawn name; preserve spawn identity in metadata (RQ-3).**
   - Active display/registry name = latest `/name` or `set_name` value.
   - Spawn name preserved as `spawn_name` metadata field.
   - Clearing `/name` reverts to spawn name or generated fallback.
   - Orchestration routes by stable ID or `spawn_name`/`role`, not mutable `name`.

4. **Adopt a command namespace policy.**
   - Exact built-in names are reserved.
   - Semantic overlaps are allowed only with explicit descriptions and docs.
   - Slash commands use kebab-case (`/coas-status`); model tools use snake_case (`coas_status`).
   - Prompt commands count as slash commands for collision purposes.
   - Human UI commands should use nouns (`/teams`, `/kanban`, `/agents`); model tools should use stable prefixed stems (`team_*`, `kanban_*`, `agent_*`).

5. **Add a namespace audit script.**
   - Fail exact built-in collisions.
   - Warn on semantic-overlap keywords.
   - Print current inventory for review.
   - Use a static `builtins.json` manifest checked into the repo rather than parsing pi dist at audit time.

6. **Document command/tool patterns in repo docs.**
   - Add this brief to `docs/README.md`.
   - Cross-link from extension READMEs where command/tool naming is explained.

7. **Optionally report upstream docs drift.**
   - `/import` is present in installed source but not in one usage table. This is not a pi-tools bug, but it affects audit accuracy.

## Validation

Performed 2026-05-04:

- Read pi usage docs and extension docs.
- Read installed pi `dist/core/slash-commands.js` for source-derived built-ins.
- Scanned `extensions/` for `registerCommand`, `registerTool`, and `registerShortcut`.
- Ran pi RPC `get_commands` in `/Users/jim/git/pi-tools-and-skills` to confirm runtime extension/prompt/skill commands.
- Reviewed `extensions/pi-panopticon/alias-command.ts` to confirm `/alias` and `set_alias` set both session name and registry name.
- Implemented Phase 1 naming changes in `pi-panopticon`: removed `/alias`, added `set_name`/`get_name`, kept deprecated `set_alias`/`get_alias` wrappers, added heartbeat sync from `pi.getSessionName()`, and preserved `spawn_name` metadata.
- Ran `default-debate` council review before writing this brief; council agreed the main risk is semantic `/name` vs `/alias` confusion, not exact collision.
- Updated recommendation after product decision: remove `/alias` directly and make Panopticon registry naming follow built-in `/name`.
- Added namespace audit: `scripts/builtins.json`, `scripts/check-namespace.mjs`, `npm run check:namespace`, and `npm run check` integration.

## Open Questions

- Prompt commands are now checked by `npm run check:namespace`; should user-installed package prompts be auditable through a separate runtime-only diagnostic?
- Is there or should there be a stable pi API for built-in command inventory instead of reading `dist/core/slash-commands.js`?
- What is Panopticon's current heartbeat interval? Is `pi.getSessionName()` cheap enough to call every heartbeat?
- Are registry names currently used as stable lookup keys by any consumers? If so, those call sites need migration to stable IDs.
- What exact tool name should be canonical: `set_name` or `set_session_name`?
- How should duplicate `/name` values be displayed or disambiguated in the registry?

## Implementation Plan

### Phase 1 — Remove `/alias` and add `set_name` (immediate)

| Step | Action | Verifies |
| ---- | ------ | -------- |
| 1.1 | Delete `/alias` slash command registration from `pi-panopticon` extension | `/alias` no longer appears in `get_commands` |
| 1.2 | Add `set_name(name)` tool to panopticon extension | Tool callable by model/RPC, sets `pi.setSessionName()` |
| 1.3 | Convert `set_alias` to a deprecated wrapper that forwards to `set_name` | Existing callers still work; deprecation notice in tool description |
| 1.4 | Rename `get_alias` to `get_name` (keep `get_alias` as deprecated wrapper) | New tool returns session name + registry name |
| 1.5 | Add heartbeat name-reconciliation to Panopticon heartbeat loop | Registry name syncs from `pi.getSessionName()` via diff check |
| 1.6 | Update Panopticon registry entry schema to include `spawn_name` field | Spawn name preserved separately from active `name` |
| 1.7 | Update docs: `/name` is canonical identity command; `set_name` is programmatic equivalent | Extension README + help text updated |

### Phase 2 — Name precedence and metadata (after Phase 1)

| Step | Action | Verifies |
| ---- | ------ | -------- |
| 2.1 | Implement name precedence: user/programmatic > spawn > generated fallback | `/name` overrides spawn name in registry; spawn name stays in metadata |
| 2.2 | Implement clear/revert: if session name cleared, registry reverts to `spawn_name` or generated fallback | No empty-identity state possible |
| 2.3 | Add disambiguation: if two agents share a `/name`, registry shows stable ID suffix | Registry listing shows unique identities |
| 2.4 | Audit orchestration call sites that route by registry name — migrate to stable ID or `spawn_name`/`role` | No routing depends on mutable display name |

### Phase 3 — Namespace policy and audit (after Phase 2)

| Step | Action | Verifies |
| ---- | ------ | -------- |
| 3.1 | Create `builtins.json` manifest of pi built-in slash commands | Done: `scripts/builtins.json` is checked in and should be manually updated on pi upgrades |
| 3.2 | Write `npm run check:namespace` audit script | Done: fails exact collisions, warns on semantic-overlap keywords, includes prompt commands |
| 3.3 | Fold namespace check into `npm run check` | Done: CI/check path enforces exact-collision policy |
| 3.4 | Document naming conventions (kebab-case slashes, snake_case tools, noun stems) in `docs/README.md` | Done: docs index links to this active policy brief |
| 3.5 | Cross-link naming conventions from each extension README | Consistent per-extension docs |

### Phase 4 — Remove deprecated tools (two releases after Phase 1)

| Step | Action | Verifies |
| ---- | ------ | -------- |
| 4.1 | Remove `set_alias` deprecated wrapper | Only `set_name` remains |
| 4.2 | Remove `get_alias` deprecated wrapper | Only `get_name` remains |
| 4.3 | Update any documentation referencing `alias` tools | No stale references |

## Progress Log

- 2026-05-04: Initial namespace investigation completed. No exact pi-tools collisions with built-in slash commands or tools found. Primary issue identified as `/name` vs `/alias` semantic overlap. Council reviewed and recommended clarifying semantics, adding a namespace policy, and adding a lightweight audit script.
- 2026-05-04: Product decision updated: remove `/alias` directly rather than deprecating it. Panopticon should use built-in `/name` as the canonical human identity command and sync the registry name from the session name.
- 2026-05-04: Council debate resolved three primary open questions (RQ-1 heartbeat sync, RQ-2 `set_name` + deprecated `set_alias`, RQ-3 `/name` overrides spawn name). ADR-002/003 promoted to Accepted; ADR-004/005 added. Implementation plan with four phases added.
- 2026-05-04: Phase 1 implemented in code. `/alias` slash command was removed; `set_name`/`get_name` are canonical programmatic tools; `set_alias`/`get_alias` are deprecated wrappers; registry records now include `spawn_name`/`name_source`; heartbeat reconciles registry name from `pi.getSessionName()` while preserving the current registry name on empty/error.
- 2026-05-04: Phase 3 namespace audit implemented. `npm run check:namespace` compares extension and prompt commands against `scripts/builtins.json`, warns on semantic-overlap keywords, prints inventory, and now runs as part of `npm run check`.

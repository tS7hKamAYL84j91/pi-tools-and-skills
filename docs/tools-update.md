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

Built-in tool names are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. No pi-tools model-facing tools currently collide with those built-ins.

## Status

| Issue                                        | Decision                         | Implementation                 | Validation                                                     | Status |
| -------------------------------------------- | -------------------------------- | ------------------------------ | -------------------------------------------------------------- | ------ |
| TCU-001 exact built-in command collision     | Prohibit                         | No current pi-tools collisions | Code scan + runtime inventory                                  | Pass   |
| TCU-002 `/name` vs `/alias` semantic overlap | Remove `/alias`; sync registry from session name | Pending | Code review confirms `/alias` sets session + registry identity | Open |
| TCU-003 command/tool naming policy           | Document predictable patterns    | Pending                        | Inventory shows several valid but undocumented patterns        | Open   |
| TCU-004 namespace audit                      | Add scripted check               | Pending                        | Manual scan done                                               | Open   |
| TCU-005 docs/runtime inventory drift         | Prefer source/runtime inventory  | Pending                        | `/import` docs discrepancy found                               | Open   |

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

- Extract pi built-ins from `@mariozechner/pi-coding-agent/dist/core/slash-commands.js` or a stable API if one becomes available.
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

**Status:** Proposed

**Decision:** pi-tools extension and prompt commands must not use exact built-in pi command names.

**Consequences:** Prevents autocomplete filtering/suffix surprises and keeps built-in mental models intact.

### ADR-002 — Built-in `/name` is the canonical human identity command

**Status:** Proposed

**Decision:** Remove the pi-tools `/alias` slash command. Panopticon should derive the registry name from pi's session name when available, so built-in `/name <name>` becomes the single human-facing command for naming the current agent/session.

**Consequences:** Eliminates the `/name` vs `/alias` split instead of documenting around it. This is a deliberate compatibility break for `/alias`, accepted because the command duplicates and broadens a built-in concept. Model-facing naming may still need a tool for non-interactive flows, but it should be explicitly tied to session/agent naming.

### ADR-003 — Command/tool names should share stems where it helps, not force one-to-one parity

**Status:** Proposed

**Decision:** Allow patterns like `/kanban` + `kanban_*` and `/teams` + `team_*`. Require descriptions to state whether a slash command is a human UI command, a model-facing tool equivalent, or both.

**Consequences:** Avoids awkward command proliferation while keeping discovery predictable.

## Recommendations

1. **Remove `/alias` and make `/name` drive Panopticon identity.**
   - Delete the `/alias` command registration.
   - Sync `registry.name` from `pi.getSessionName()` whenever a session name exists.
   - Use the current fallback naming only when there is no session name.
   - Update docs/help to say: use built-in `/name <name>` to name this session/agent for Panopticon.

2. **Keep or rename model-facing alias tools deliberately.**
   - The model cannot reliably invoke built-in interactive `/name`, so a tool may still be useful.
   - If retained, prefer `set_agent_name` or `set_session_name` semantics and treat `set_alias` as removable or compatibility-only.
   - `get_alias` should become `get_agent_name`/`get_session_name` or clearly report session name and registry name.

3. **Adopt a command namespace policy.**
   - Exact built-in names are reserved.
   - Semantic overlaps are allowed only with explicit descriptions and docs.
   - Prompt commands count as slash commands for collision purposes.
   - Human UI commands should use nouns (`/teams`, `/kanban`, `/agents`); model tools should use stable prefixed stems (`team_*`, `kanban_*`, `agent_*`).

4. **Add a namespace audit script.**
   - Fail exact built-in collisions.
   - Warn on semantic-overlap keywords.
   - Print current inventory for review.

5. **Document command/tool patterns in repo docs.**
   - Add this brief to `docs/README.md`.
   - Cross-link from extension READMEs where command/tool naming is explained.

6. **Optionally report upstream docs drift.**
   - `/import` is present in installed source but not in one usage table. This is not a pi-tools bug, but it affects audit accuracy.

## Validation

Performed 2026-05-04:

- Read pi usage docs and extension docs.
- Read installed pi `dist/core/slash-commands.js` for source-derived built-ins.
- Scanned `extensions/` for `registerCommand`, `registerTool`, and `registerShortcut`.
- Ran pi RPC `get_commands` in `/Users/jim/git/pi-tools-and-skills` to confirm runtime extension/prompt/skill commands.
- Reviewed `extensions/pi-panopticon/alias-command.ts` to confirm `/alias` and `set_alias` set both session name and registry name.
- Ran `default-debate` council review before writing this brief; council agreed the main risk is semantic `/name` vs `/alias` confusion, not exact collision.
- Updated recommendation after product decision: remove `/alias` directly and make Panopticon registry naming follow built-in `/name`.

## Open Questions

- What extension event or lightweight polling point should Panopticon use to detect built-in `/name` changes? Candidate: heartbeat-time sync from `pi.getSessionName()`.
- Should `set_alias` be removed at the same time as `/alias`, or kept temporarily because models/RPC cannot call built-in interactive `/name`?
- If a spawned agent has an explicit spawn name and the user later sets `/name`, should `/name` always override the spawn name? Proposed: yes, because it is an explicit user action.
- Should prompt commands be checked in CI alongside extension commands?
- Is there or should there be a stable pi API for built-in command inventory instead of reading `dist/core/slash-commands.js`?

## Progress Log

- 2026-05-04: Initial namespace investigation completed. No exact pi-tools collisions with built-in slash commands or tools found. Primary issue identified as `/name` vs `/alias` semantic overlap. Council reviewed and recommended clarifying semantics, adding a namespace policy, and adding a lightweight audit script.
- 2026-05-04: Product decision updated: remove `/alias` directly rather than deprecating it. Panopticon should use built-in `/name` as the canonical human identity command and sync the registry name from the session name.

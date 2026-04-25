# Council Extension Plan

The Council extension implements a split-brain multi-agent debate and consensus pattern, built entirely on top of the `pi-panopticon` orchestration primitives. It allows the primary orchestrator agent to form a heterogeneous council of models, debate a complex topic, and synthesize a final recommendation that explicitly preserves disagreement.

## 1. Core Architecture

The extension is not a standalone subprocess runner. Instead, it relies on the existing `pi-panopticon` capabilities:

- **Lifecycle:** Council members are spawned as persistent RPC agents (`spawn_agent` / `kill_agent`).
- **Comms:** Deliberation uses structured RPC commands, with fallback to `agent_send` and `message_read` for free-form peer debate.
- **Visibility:** Members are spawned with `PI_PANOPTICON_VISIBILITY=scoped`, meaning they see their parent and each other, but not unrelated agents.
- **Monitoring:** The orchestrator can monitor members using `agent_peek`, check their health with `agent_status`, and unblock them with `agent_nudge` if they stall.

### 1.1 The "Split-Brain" Pattern
- **System 1 (Orchestrator):** The primary `pi` session interacting with the user.
- **System 2 (Council):** A named group of 3–5 specialized, isolated worker agents running different models.

### 1.2 The 3-Stage Debate Protocol
1. **Parallel Generation:** The orchestrator sends the prompt via RPC to all members simultaneously.
2. **Anonymized Peer Review:** The orchestrator strips model identities ("Agent A", "Agent B"), collects the Stage 1 answers, and sends them back to all members for critique and ranking.
3. **Chairman Synthesis:** A designated high-reasoning model (The Chairman) receives the original prompt, the raw answers, and the anonymized critiques, then synthesizes a final recommendation that highlights consensus and points of disagreement.

## 2. Configuration and Model Selection

Council definitions live at two levels:

1. **Global Defaults (`~/.pi/agent/settings.json`)**
   Configured during `make setup`. Defines the default models for members and the chairman.
2. **Session-Local Councils**
   Formed during a session via the `/council-form` command or `council_form` tool. These override the global defaults.

### 2.1 Model Selection UX
- **Tool Path:** The `council_form` tool accepts explicit model IDs (e.g., `openai/gpt-5.5`). It validates these against `ctx.modelRegistry.getAvailable()`.
- **Interactive Path:** A `/council-form` slash command uses `ctx.ui.select` to provide a standard TUI picker over available models, allowing the user to select members and the chairman interactively.

## 3. Tool and Command Surface

The extension registers the following capabilities:

### Tools (Model-Callable)
- `council_form`: Create or replace a session-local council (name, purpose, members, chairman).
- `ask_council`: Trigger the 3-stage debate protocol on a named council (or the default). Ensures the panopticon workers are spawned and alive.
- `council_list`: List available session councils.
- `council_status`: Check the panopticon health (`agent_status`) of current council members.
- `council_dissolve`: Gracefully terminate the panopticon workers (`kill_agent`) and remove the council definition.

### Commands (User-Callable)
- `/council-form`: Interactive TUI wizard to pick models and name a new council.
- `/council-last`: Show the TUI summary of the most recent deliberation.
- `/council-status`: Human-readable health check of council members.

## 4. Implementation Steps

1. **Extract Spawn Service:**
   Refactor `extensions/pi-panopticon/spawner.ts` to expose a `SpawnService` (or use the pure functions in `spawner-utils.ts` directly) so the Council extension can programmatically manage child agents without invoking the string-based tool API.

2. **Build Council State Manager:**
   Create a registry within `extensions/council/` to map council definitions to their spawned panopticon PIDs.

3. **Implement Model Resolution:**
   Wire up `ctx.modelRegistry.getAvailable()` to validate tool inputs and power the `/council-form` interactive picker.

4. **Implement the 3-Stage Protocol:**
   Write the orchestration loop for `ask_council`:
   - Ensure workers are spawned (with `--no-tools` or restricted tools).
   - Dispatch `prompt` RPCs in parallel (Stage 1).
   - Anonymize and dispatch critique RPCs (Stage 2).
   - Dispatch synthesis RPC to the chairman (Stage 3).

5. **Integrate Health and Nudging:**
   Expose `council_status` so the orchestrator can call `agent_status` on the council group, and use `agent_nudge` if a member stalls during deliberation.

6. **Setup Integration:**
   Update `scripts/setup-pi` to write intelligent fallback models into the `council` section of `settings.json`.

## 5. Reference Patterns
- **Karpathy Framework:** Collect → Rank → Synthesize.
- **Scoped Visibility:** `PI_PANOPTICON_VISIBILITY=scoped` ensures council members operate in a clean room, unable to see unrelated session activity.
- **Stall Recovery:** Leverage existing `agent_nudge` and `agent_peek` rather than building bespoke timeout handlers.

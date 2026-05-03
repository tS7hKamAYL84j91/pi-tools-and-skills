# Teams Future Improvements TODO

Based on the architectural review of the `pi-teams` extension, here are the concrete improvements we should pursue next to evolve it into a robust, generic "teams" platform:

## 1. Eliminate Global Provider Overrides that Break Model Compatibility
Currently, `provider-overrides-extension.ts` blindly merges environment parameters (like `{ "temperature": ... }`) into all provider payloads via the `before_provider_request` hook. 
- **The Bug:** This breaks providers like Google Gemini that do not accept parameters like `temperature` at the root level (causing 400 Errors when changing the chairman model from OpenAI to Gemini).
- **Task:** Remove `provider-overrides-extension.ts` entirely. Generation parameters should be passed strictly via the native API payload builder, which knows how to map parameters to provider-specific schemas (e.g., Gemini's `generationConfig`).
- **Benefit:** Fixes model portability within teams.

## 2. Consolidate Prompts, Subagents, and Teams
Currently, behavior is fragmented across three places:
1. **Subagents:** Define `systemPrompt`, `model`, and `tools`.
2. **Teams:** Define `protocol`, `topology`, and bind subagents to roles.
3. **Prompts / Settings:** Hardcode the protocol-specific templates (like `councilCritiqueTemplate` or `councilSynthesisTemplate`) in `prompts.ts` or `settings.ts`.

- **Task:** We need an explicit conceptual link between Prompts and Teams. Why have separate prompts rather than notes in the Team spec or framing in the Subagent's `systemPrompt`? The protocol templates (e.g., "Review these peer outputs...") should belong directly to the Team's protocol configuration, or be dynamically constructed using the subagent's framing.
- **Benefit:** Reduces indirection. A user reviewing a Team spec can immediately see the templates it uses to orchestrate its members, rather than hunting through extension source code or hidden prompt template files.

## 3. Fully Honor Subagent Manifest Parameters
The subagent Markdown files define fields like `tools: []` and `parameters: { temperature: 0.1 }`, but the underlying `runMember()` executor mostly ignores them, focusing only on the `model` and system prompt.
- **Task:** Pass the subagent's allowed tools and specific generation parameters directly to the provider payload (handled safely by the provider, fixing point 1).
- **Benefit:** Enables a team to have one highly-creative generation member (Temp 0.9, no tools) and a strict validation member (Temp 0.0, read-only tools).

## 4. Unify State Management with Pi's Native Session Tree
The `CouncilStateManager` currently maintains its own local or extension-specific persistence.
- **Task:** Migrate team deliberation state into Pi's native event-sourced `sessionManager` using `pi.appendEntry(customType)`.
- **Benefit:** Ensures that team workflows branch, fork, and compact correctly along with the user's conversation tree, rather than living in parallel.

## 5. Collapse Topology vs. Protocol Redundancy
Right now, specs require both `topology: "council"` and `protocol: "debate"`. In practice, a protocol dictates the topology.
- **Task:** Deprecate `topology` in favor of just `protocol` (or `engine`), and make the `agentBindings` dynamically define the shape of the graph based on the roles present.
- **Benefit:** Simplifies team creation and eliminates redundancy.

## 6. Move Toward a Graph-Based Execution Engine
The `team-handlers.ts` file hardcodes the execution flow for each protocol (e.g., a `for` loop for telephone, parallel `Promise.all` for debate generation).
- **Task:** Implement a generic DAG (Directed Acyclic Graph) executor. A team spec would define `edges` between agent roles.
- **Benefit:** Allows users to create entirely new workflows (like `Review -> Fix -> QA -> Merge`) purely in YAML without needing to write a new TypeScript handler for every new workflow shape.

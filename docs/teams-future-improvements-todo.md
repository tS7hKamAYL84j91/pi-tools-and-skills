# Teams Future Improvements TODO

Based on the architectural review of the `pi-llm-council` extension, here are the concrete improvements we should pursue next to evolve it into a robust, generic "teams" platform:

## 1. Eliminate Hardcoded Prompts in Favor of Templates
Currently, `prompts.ts` and `deliberation.ts` contain hardcoded template strings for orchestrating the debate, critiques, and pair-coding primers.
- **Task:** Move these into Pi's native `.md` template registry (e.g., `extensions/pi-llm-council/config/prompts/`) and render them through the native context engine.
- **Benefit:** Allows users to override workflow prompts just like they override subagent files.

## 2. Fully Honor Subagent Manifest Parameters
The subagent Markdown files define fields like `tools: []` and `parameters: { temperature: 0.1 }`, but the underlying `runMember()` executor mostly ignores them, focusing only on the `model` and system prompt.
- **Task:** Pass the subagent's allowed tools and specific generation parameters directly to the provider payload.
- **Benefit:** Enables a team to have one highly-creative generation member (Temp 0.9, no tools) and a strict validation member (Temp 0.0, read-only tools).

## 3. Unify State Management with Pi's Native Session Tree
The `CouncilStateManager` currently maintains its own local or extension-specific persistence.
- **Task:** Migrate team deliberation state into Pi's native event-sourced `sessionManager` using `pi.appendEntry(customType)`.
- **Benefit:** Ensures that team workflows branch, fork, and compact correctly along with the user's conversation tree, rather than living in parallel.

## 4. Collapse Topology vs. Protocol Redundancy
Right now, specs require both `topology: "council"` and `protocol: "debate"`. In practice, a protocol dictates the topology.
- **Task:** Deprecate `topology` in favor of just `protocol` (or `engine`), and make the `agentBindings` dynamically define the shape of the graph based on the roles present.
- **Benefit:** Simplifies team creation and eliminates redundancy.

## 5. Move Toward a Graph-Based Execution Engine
The `team-handlers.ts` file hardcodes the execution flow for each protocol (e.g., a `for` loop for telephone, parallel `Promise.all` for debate generation).
- **Task:** Implement a generic DAG (Directed Acyclic Graph) executor. A team spec would define `edges` between agent roles.
- **Benefit:** Allows users to create entirely new workflows (like `Review -> Fix -> QA -> Merge`) purely in YAML without needing to write a new TypeScript handler for every new workflow shape.

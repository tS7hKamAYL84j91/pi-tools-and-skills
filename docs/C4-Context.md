# Level 1: System Context

<!-- c4-auto-start: context -->
```mermaid
C4Context
    title System Context — tools-and-skills

    Person(id_1, "Developer", "Uses pi CLI interactively")

    System(id_2, "Pi Coding Agent", "CLI + LLM agent loop. Loads extensions, skills, prompts.")
    System_Ext(id_8, "LLM Provider", "Anthropic, OpenAI, etc.")
    System_Ext(id_9, "Shared Filesystem", "~/.pi/agents/ registry, Maildir queues, session JSONL")

    Rel(id_1, id_2, "Prompts, commands, /alias, /agents")
    Rel(id_2, id_8, "API calls (chat completions)")
    Rel(id_2, id_9, "Reads/writes agent records, messages, session logs")
```
<!-- c4-auto-end: context -->

Multiple pi instances run concurrently — each loads pi-panopticon, registers in the shared filesystem registry, and communicates with peers via Maildir queues.

```mermaid
C4Context
    title Multi-Agent Context

    Person(dev, "Developer")

    System(agentA, "Pi Agent A", "Parent agent (interactive)")
    System(agentB, "Pi Agent B", "Spawned child (RPC mode)")
    System(agentC, "Pi Agent C", "Spawned child (RPC mode)")

    SystemDb(registry, "Agent Registry", "~/.pi/agents/*.json")
    SystemDb(maildir, "Maildir Queues", "~/.pi/agents/{id}/inbox/")
    SystemDb(sessions, "Session Logs", "~/.pi/agent/sessions/…/*.jsonl")

    Rel(dev, agentA, "Interactive prompts")
    Rel(agentA, agentB, "spawn_agent + rpc_send (stdin/stdout)")
    Rel(agentA, agentC, "spawn_agent + rpc_send (stdin/stdout)")
    Rel(agentA, registry, "Registers, heartbeats")
    Rel(agentB, registry, "Registers, heartbeats")
    Rel(agentC, registry, "Registers, heartbeats")
    Rel(agentA, maildir, "agent_send → write to peer inbox")
    Rel(agentB, maildir, "drainInbox → read own inbox")
    Rel(agentA, sessions, "agent_peek → read peer session JSONL")
```

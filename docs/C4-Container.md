# Level 2: Container

<!-- c4-auto-start: container -->
```mermaid
C4Container
    title Container — tools-and-skills repo

    Person(id_1, "Developer", "Uses pi CLI interactively")

    System_Boundary(repo, "Pi Coding Agent") {
        Container(id_3, "pi-jb-agents", "Unified agent infrastructure: registry, messaging, spawning, monitoring", "TypeScript, Pi Extension")
        Container(id_4, "lib/", "Shared interfaces and IO", "TypeScript")
        Container(id_5, "skills/", "5 specialized agent skills: planning, research, red-team, weather, skill-creator", "Markdown + scripts")
        Container(id_6, "prompts/", "Prompt templates: refactor, commit-and-push", "Markdown")
        Container(id_7, "tests/", "102 tests: registry, messaging, spawner, lifecycle, maildir", "Vitest")
    }

    System_Ext(id_8, "LLM Provider", "Anthropic, OpenAI, etc.")
    System_Ext(id_9, "Shared Filesystem", "~/.pi/agents/ registry, Maildir queues, session JSONL")

    Rel(id_1, id_2, "Uses")
    Rel(id_3, id_4, "Imports types, IO, transports")
    Rel(id_3, id_9, "Registry files, Maildir queues, sockets")
    Rel(id_7, id_3, "Tests extension modules")
    Rel(id_7, id_4, "Tests library layer")
    Rel(id_1, id_2, "Uses")
```
<!-- c4-auto-end: container -->

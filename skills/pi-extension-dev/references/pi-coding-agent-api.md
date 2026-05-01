
# pi-coding-agent-api — Extension API surface for @mariozechner/pi-coding-agent

> Canonical imports, key types, and patterns for building pi extensions.

## Common operations

- Import extension types:
  `import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"`

- Import tool definition types:
  `import type { ToolDefinition, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent"`

- Import UI border component:
  `import { DynamicBorder } from "@mariozechner/pi-coding-agent"`

- Import theme:
  `import { Theme, type ThemeColor } from "@mariozechner/pi-coding-agent"`

- Import schema helper for Google-safe enums:
  `import { StringEnum } from "@mariozechner/pi-ai"`

- Import typebox for tool parameters:
  `import { Type } from "@sinclair/typebox"`

- Import file mutation queue:
  `import { withFileMutationQueue } from "@mariozechner/pi-coding-agent"`

## Patterns

- Register a tool:
  `pi.registerTool({ name, label, description, promptSnippet, parameters: Type.Object({...}), execute })`

- Register a command:
  `pi.registerCommand("name", { description, handler: async (args, ctx) => {...} })`

- Register a shortcut:
  `pi.registerShortcut("ctrl+shift+x", { description, handler: async (ctx) => {...} })`

- Persist extension state across sessions:
  `pi.appendEntry("my-type", data)` then restore in `session_start` from `ctx.sessionManager.getEntries()`

- Open a custom overlay:
  `await ctx.ui.custom((tui, theme, kb, done) => component, { overlay: true })`

- Inject into system prompt:
  `pi.on("before_agent_start", async (event) => ({ systemPrompt: event.systemPrompt + extra }))`

## Gotchas

- Tool execute must THROW to signal errors — returning `{ isError: true }` does nothing for the model
- `Type.Union`/`Type.Literal` broken with Google models — use `StringEnum` from `@mariozechner/pi-ai`
- `ctx.signal` is undefined outside active turns — guard before using
- `DynamicBorder` comes from `@mariozechner/pi-coding-agent`, NOT from `@mariozechner/pi-tui`
- `Container`, `Text`, `SelectList` come from `@mariozechner/pi-tui`, NOT from `@mariozechner/pi-coding-agent`
- `pi.appendEntry()` does NOT enter LLM context — it is extension-only persistence
- `ctx.reload()` in a command handler: code after it runs from the OLD version — treat as terminal
- `session_start` reason can be: "startup", "reload", "new", "resume", "fork"
- File-mutating tools must use `withFileMutationQueue(absolutePath, async () => {...})`
- `promptSnippet` opts a tool into the "Available tools" prompt — omit and it is invisible there

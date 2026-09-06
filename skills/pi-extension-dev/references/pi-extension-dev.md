# Building Pi Extensions

Register tools, lifecycle hooks, commands, and TUI feedback through the installed
`@earendil-works/pi-coding-agent` API. See [API contracts](pi-coding-agent-api.md)
and [TUI components](pi-tui.md); verify against the installed documentation before
implementing version-sensitive behavior.

## Minimal tool and command

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "example_action",
    label: "Example Action",
    description: "Return the requested example action.",
    promptSnippet: "Return an example action",
    parameters: Type.Object({ action: StringEnum(["list", "add"] as const) }),
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: params.action }],
        details: { action: params.action },
      };
    },
  });

  pi.registerCommand("example-status", {
    description: "Show example status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify("Example ready", "info");
    },
  });
}
```

## Implementation patterns

- Use TypeScript ESM and `.js` suffixes for local imports in this repository.
- For tools in this repository's `extensions/<name>/` directories, use
  `import { ok, type ToolResult } from "../../lib/tool-result.js"` for compact results.
  That path is repo-local, not an SDK export or a portable third-party dependency.
- Throw from `execute` to report a tool failure. Use `StringEnum` rather than
  literal unions for Google-facing enum schemas.
- Register `pi.on("session_start", ...)` for session setup; dispose watchers,
  processes, sockets, and timers in an idempotent `session_shutdown` handler.
- Return a modified `systemPrompt` from `before_agent_start` for deliberate context
  injection. Do not mistake persisted custom entries for model-visible messages.
- Use `ctx.ui.setWidget("key", ["line1", "line2"])` for multi-line feedback and
  `ctx.ui.setStatus("key", "text")` for concise status. Clear stale UI deliberately.
- Use `withFileMutationQueue` from coding-agent around the complete mutation
  window, with an absolute validated target path. Keep domain locks and safety gates.
- Guard turn-only `ctx.signal` before use. Treat reload as terminal for the old handler.

## Loading

Pi auto-discovers global `~/.pi/agent/extensions/` and trusted project
`.pi/extensions/`. This repository's `extensions/` are loaded through package
manifests or explicit settings; do not assume arbitrary `project-extensions/`
directories are automatically discovered. Other repos may explicitly register them.

A package's `pi.extensions` paths are relative to its package root. Read the
installed `docs/packages.md` before changing packaging or dependencies. Never
change live registrations merely to test a code change.

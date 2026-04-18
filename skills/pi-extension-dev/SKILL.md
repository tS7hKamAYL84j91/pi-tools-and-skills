---
name: pi-extension-dev
description: Build or modify pi extensions. Use when creating tools, commands, lifecycle hooks, TUI widgets, or file-mutating extension logic, especially in TypeScript ESM projects.
---

# Pi Extension Development

Use this skill when implementing or changing a pi extension.

## When to use

Use this skill for:
- adding a new pi tool
- registering commands
- handling lifecycle events
- injecting prompt context
- building TUI widgets or status items
- implementing file-mutating extension behavior safely

## Workflow

1. **Read the relevant pi docs first**
   - Follow the project rule for pi topics: read the documentation and linked examples before implementing.
   - Check extension docs, TUI docs, SDK docs, and examples as needed.

2. **Decide the extension surface**
   - **Tool**: model-callable capability.
   - **Command**: user-triggered slash command.
   - **Lifecycle hook**: behavior tied to session/agent events.
   - **TUI widget/status**: visual feedback in the interface.

3. **Design the API shape**
   - Give the tool/command a narrow purpose.
   - Define explicit parameters.
   - Prefer simple return shapes and clear error behavior.

4. **Implement in TypeScript ESM**
   - Use ES module imports.
   - Use `.js` import suffixes.
   - Use `import type` for type-only imports.
   - Prefer small helpers over large inline handlers.

5. **Handle mutations safely**
   - If the extension writes to files, route those operations through the file mutation queue.
   - Keep mutation regions narrow and deterministic.

6. **Integrate with pi lifecycle**
   - Use `pi.on(...)` only where a lifecycle hook is actually needed.
   - Guard turn-specific APIs such as `ctx.signal`.
   - Treat reload behavior as a lifecycle boundary.

7. **Validate the user experience**
   - Make tool descriptions clear.
   - Add `promptSnippet` only when the tool should appear in the prompt tool list.
   - Ensure errors throw rather than silently returning error-shaped data.

8. **Verify**
   - Run the project checks.
   - Test the extension path you changed.
   - Confirm no unused exports/imports remain.

## Design heuristics

- Prefer one focused tool over a general-purpose kitchen-sink tool.
- Use commands for human workflow helpers, not for capabilities the model should call directly.
- Put detailed documentation in references/examples rather than bloating the extension implementation.
- Prefer native Node APIs over new dependencies.

## Common build patterns

### Adding a tool
- Define schema
- Register with `pi.registerTool(...)`
- Implement `execute`
- Throw on errors
- Return a compact success result

### Adding a command
- Register with `pi.registerCommand(...)`
- Validate args early
- Keep handler flow short
- Treat reload as terminal when applicable

### Adding UI feedback
- Use `ctx.ui.setWidget(...)` for multi-line display
- Use `ctx.ui.setStatus(...)` for concise status
- Remove or refresh stale UI state deliberately

## Companion memory

For code snippets, API reminders, and known gotchas, use the `pi-extension-dev` machine memory.

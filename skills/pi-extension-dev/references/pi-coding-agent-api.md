# Pi Coding Agent Extension API

Checked against the repository's `@earendil-works/pi-coding-agent` 0.84.4 types.
Read the installed `docs/extensions.md` and relevant examples before implementing;
installed declarations are authoritative when examples describe a newer API.

## Imports

- Extension types: `ExtensionAPI`, `ExtensionContext`, `ExtensionCommandContext`.
- Tool types: `ToolDefinition`, `AgentToolResult`, `AgentToolUpdateCallback`.
- UI framing: `DynamicBorder`; theme types: `Theme`, `ThemeColor`.
- File mutation queue: `withFileMutationQueue`.

All of the above come from `@earendil-works/pi-coding-agent`. `Container`, `Text`,
and `SelectList` come from `@earendil-works/pi-tui`, not coding-agent. See
[Pi TUI](pi-tui.md) for component signatures.

Use `StringEnum` and `Type` from `@earendil-works/pi-ai` together for the installed
SDK's Google-compatible enum schemas. Existing repo tools use `@sinclair/typebox`;
do not mix its schema builders with a newer `StringEnum` from `typebox`.
Pi's extension loader supplies the bundled pi-ai package at runtime. For standalone
typechecking, declare compatible SDK peers/dev dependencies or resolve against the
installed SDK's dependency tree; this repository does not hoist pi-ai to its root.

## Registration and lifecycle

- Tool: `pi.registerTool({ name, label, description, promptSnippet, parameters, execute })`.
- Command: `pi.registerCommand("name", { description, handler })`.
- Shortcut: `pi.registerShortcut("ctrl+shift+x", { description, handler })`.
- System prompt: return `{ systemPrompt: event.systemPrompt + extra }` from
  `before_agent_start`; preserve the current chained prompt.
- Overlay: `await ctx.ui.custom((tui, theme, keybindings, done) => component, { overlay: true })`.
  Guard terminal-only components with `ctx.mode === "tui"`; RPC also has `ctx.hasUI`.
- Persistence: `pi.appendEntry("my-type", data)` stores extension-only state,
  not LLM context. Restore the current branch with `ctx.sessionManager.getBranch()`;
  use `getEntries()` only when deliberately inspecting all branches.
- `session_start` reasons: `startup`, `reload`, `new`, `resume`, `fork`.
  Start background resources here, not in the factory, and clean up on `session_shutdown`.
- `agent_end` can precede retry, compaction, or queued follow-ups. For fully settled
  status integrations, the installed SDK exposes `agent_settled`.

## Contracts and safety

- `execute(toolCallId, params, signal, onUpdate, ctx)` must throw to signal failure.
  Returning `{ isError: true }` from an extension tool does not set its error flag.
  This rule is for Pi extension tools, not unrelated MCP server result contracts.
- `promptSnippet` opts a tool into the default prompt's **Available tools** list.
  Omitting it does not unregister the tool or make its schema uncallable.
- Guard `ctx.signal`: it is undefined outside an active agent turn.
- `pi.setModel(model)` returns `Promise<boolean>`; `false` means authentication is
  unavailable. Handle both false returns and thrown errors before updating state.
- Queue the entire read/modify/write window with
  `withFileMutationQueue(absolutePath, async () => { ... })`, not just the write.
  Preserve domain locks, atomic persistence, permissions, and path validation too.
- Treat command `await ctx.reload(); return;` as terminal: subsequent code is still
  in the old handler. After session replacement, use the fresh `withSession` context,
  not captured old session-bound objects.
- Never log credentials, raw session contents, or provider payloads as diagnostics.

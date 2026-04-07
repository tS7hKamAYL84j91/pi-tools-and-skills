# CoAS Kanban — VSCode Extension

A live kanban board panel for VSCode. Reads `board.log` directly (same event-sourcing model as the pi extension) and auto-refreshes whenever the file changes.

## Features

- **Live board view** — five columns: Backlog, Todo, In Progress, Blocked, Done
- **Drag and drop** — move tasks between columns; WIP limit enforced (3 in-progress max)
- **Inline editing** — click a task to edit title, priority, tags, and description
- **Create tasks** — form at the top of the Backlog column; auto-assigns next T-NNN ID
- **Add notes** — append timestamped progress notes to any task
- **Delete tasks** — with confirmation prompt (records `DELETE` event in board.log)
- **Block with reason** — dragging to Blocked prompts for a block reason via input box
- **Auto-refresh** — VSCode file watcher triggers debounced refresh (200 ms) on every board.log change

All actions write events directly to `board.log` (as agent `vscode-kanban`), so they're immediately visible to any pi agent watching the same board.

## Install

### Option A: Pre-built VSIX (recommended)

```bash
code --install-extension coas-kanban-0.1.0.vsix
```

Or in VSCode: **Extensions → … → Install from VSIX** → select `coas-kanban-0.1.0.vsix`.

### Option B: Build from source

```bash
cd vscode-extension
npm install
npm run build      # esbuild → out/extension.js
npm run package    # vsce → coas-kanban-0.1.0.vsix
code --install-extension coas-kanban-0.1.0.vsix
```

Requirements: Node ≥18, `@vscode/vsce` (installed as devDependency).

## Usage

1. Open VSCode in a project that has a `kanban/board.log` (or set `KANBAN_DIR`)
2. Open the Command Palette (`⌘⇧P` / `Ctrl⇧P`)
3. Run **CoAS: Open Kanban Board**

The panel opens in the active editor column and stays in sync with `board.log`.

## Column Transitions

| From         | To           | Events written                             |
|--------------|--------------|--------------------------------------------|
| Backlog      | Todo         | `MOVE from=backlog to=todo`                |
| Todo         | Backlog      | `MOVE from=todo to=backlog`                |
| Todo         | In Progress  | `CLAIM expires=…` + `MOVE to=in-progress`  |
| In Progress  | Done         | `COMPLETE duration=unknown` + `MOVE`       |
| In Progress  | Blocked      | `BLOCK reason="…"` + `MOVE to=blocked`     |
| Blocked      | In Progress  | `UNBLOCK` + `CLAIM` + `MOVE to=in-progress`|

Invalid transitions (e.g. Backlog → Done) are blocked in the UI.

## Board Location

The extension resolves `board.log` using the same logic as the pi extension:
1. `KANBAN_DIR` environment variable (set in VSCode's terminal env or launch config)
2. `~/git/coas/kanban/`
3. `<workspace>/kanban/`

## Development

```
vscode-extension/
  src/extension.ts      Registers "coas.openKanban" command, manages panel lifecycle
  src/kanbanPanel.ts    WebviewPanel host: parses board.log, handles UI messages
  media/kanban.js       Frontend JS: column rendering, drag-and-drop, forms
  media/kanban.css      Panel styles
  out/extension.js      Compiled output (committed for easy install)
```

The panel shares `board.ts` and `agent-api.ts` from `../../project-extensions/kanban/` and `../../lib/` respectively — it reads live agent model info from the panopticon registry for in-progress task display.

### Watch mode

```bash
npm run watch    # rebuilds on every source change
```

# Pi TUI Capabilities & Extension Ecosystem

_Research: 2026-03-30_

## Pi's Built-in TUI API

Pi has a rich TUI component system via `@mariozechner/pi-tui`. Extensions access it through `ctx.ui.*` methods.

### UI Primitives Available to Extensions

| API | What it does |
|---|---|
| `ctx.ui.setStatus(id, text)` | Persistent text in the footer bar |
| `ctx.ui.setWidget(id, lines, opts)` | Persistent content above or below the editor (`aboveEditor` / `belowEditor`) |
| `ctx.ui.setFooter(factory)` | Replace the entire footer with custom component |
| `ctx.ui.setHeader(factory)` | Replace the header (logo + keybindings) |
| `ctx.ui.setEditorComponent(factory)` | Replace the input editor (vim mode, etc.) |
| `ctx.ui.custom(factory)` | Full-screen custom TUI component with keyboard input |
| `ctx.ui.custom(factory, { overlay: true })` | Overlay component on top of existing content |
| `ctx.ui.notify(msg, level)` | Toast notification |

### Built-in Components (`@mariozechner/pi-tui`)

| Component | Description |
|---|---|
| `Text` | Multi-line text with word wrapping |
| `Box` | Container with padding and background |
| `Container` | Vertical grouping of child components |
| `Spacer` | Empty vertical space |
| `Markdown` | Markdown renderer with syntax highlighting |
| `Image` | Image display (Kitty/iTerm2/Ghostty/WezTerm) |
| `SelectList` | Interactive selection from list of items |
| `SettingsList` | Toggle settings with value cycling |
| `BorderedLoader` | Spinner with cancel support |
| `DynamicBorder` | Themed horizontal rule/border |

### Key Patterns for Dashboard/Monitor UIs

1. **Widgets** (`setWidget`) — Best for persistent status displays. Can go above or below editor. Our `agent-panopticon.ts` uses this for the agent list widget.

2. **Status line** (`setStatus`) — Footer-bar indicators. Lightweight, multiple extensions can each add one.

3. **Custom footer** (`setFooter`) — Full control over footer. Access to git branch, token stats, extension statuses.

4. **Overlays** — Dialogs/panels that float over content. Support anchoring (9 positions), sizing (%, px, responsive), and stacking.

5. **Full custom TUI** (`ctx.ui.custom`) — Takes over the screen for interactive components. Used by games (snake, space-invaders), selection dialogs, etc.

## Existing TUI/Dashboard Extensions in the Wild

### High Relevance (Dashboard/Monitor)

| Extension | Description | Repo |
|---|---|---|
| **pi-canvas** | Interactive TUI canvases (calendar, document, flights) rendered inline using native pi TUI | `jyaunches/pi-canvas` |
| **pi-ds** | TUI design system — `Alert`, `Flex`, `Grid`, `Modal`, `Sized` components for building complex layouts | `zenobi-us/pi-ds` |
| **pi-cost-dashboard** | Interactive web dashboard for API cost monitoring | `mrexodia/pi-cost-dashboard` |
| **shitty-extensions** | Collection including: `status-widget` (provider status in footer), `usage-bar` (AI usage stats with polling), `ultrathink` (animated effects) | `hjanuschka/shitty-extensions` |
| **pi-extensions/usage-extension** | Usage statistics dashboard across sessions | `tmustier/pi-extensions` |
| **rhubarb-pi/session-color** | Colored footer band to visually distinguish sessions | `qualisero/rhubarb-pi` |
| **pi-interactive-shell** | Observable overlay for interactive CLI control — full PTY emulation, user can take over | `nicobailon/pi-interactive-shell` |

### Medium Relevance (Agent/Process Management)

| Extension | Description | Repo |
|---|---|---|
| **pi-messenger** | Multi-agent communication extension | `nicobailon/pi-messenger` |
| **agent-of-empires** | Terminal session manager with git worktrees | `njbrake/agent-of-empires` |
| **gob** | Process manager for AI agents with background job support and TUI interface | `juanibiapina/gob` |
| **overstory** | Multi-agent orchestration with pluggable runtime adapters | `jayminwest/overstory` |
| **pi-notification-extension** | Telegram/bell alerts when agent finishes | `lsj5031/pi-notification-extension` |

### Official Example Extensions (in pi-mono)

| Example | TUI Feature Demonstrated |
|---|---|
| `status-line.ts` | `setStatus` — turn counter in footer |
| `custom-footer.ts` | `setFooter` — token stats, git branch, costs |
| `custom-header.ts` | `setHeader` — pi mascot ASCII art |
| `widget-placement.ts` | `setWidget` — above/below editor |
| `plan-mode.ts` | `setStatus` + `setWidget` — plan display |
| `model-status.ts` | `setStatus` — model change indicator |
| `todo.ts` | Custom tool rendering + state in session |
| `snake.ts` / `space-invaders.ts` | Full custom TUI with game loop |
| `modal-editor.ts` | `setEditorComponent` — vim-like editing |
| `overlay-qa-tests.ts` | Overlay positioning, sizing, stacking |
| `built-in-tool-renderer.ts` | Custom rendering for tool calls/results |

## What We Already Have

Our `agent-panopticon.ts` uses:
- `setWidget("agent-panopticon", lines, { placement: "belowEditor" })` — agent list widget
- `setStatus("agent-panopticon", text)` — agent count in footer
- Unix socket IPC (`~/.pi/agents/{id}.sock`) for agent-to-agent messaging
- Maildir (`~/.pi/agents/{id}/`) for passive activity observation

## Opportunities for a Kanban Dashboard

Given pi's TUI API, we could build:

1. **Kanban status widget** — `setWidget` showing current board state (backlog count, WIP, blocked) below editor
2. **Kanban overlay** — `ctx.ui.custom(..., { overlay: true })` with a side panel showing full board
3. **Agent monitor widget** — Real-time stall/active/blocked counts in footer via `setStatus`
4. **Interactive board** — Full `ctx.ui.custom` TUI with SelectList for task management
5. **pi-ds integration** — Use `Grid`/`Flex`/`Alert` components for richer layouts

### Recommended Repos to Clone/Study

- [ ] `zenobi-us/pi-ds` — TUI design system (Grid, Flex, Modal, Alert)
- [ ] `hjanuschka/shitty-extensions` — status-widget and usage-bar patterns
- [ ] `jyaunches/pi-canvas` — inline TUI canvas rendering
- [ ] `nicobailon/pi-interactive-shell` — observable overlay pattern

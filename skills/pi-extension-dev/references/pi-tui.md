
# pi-tui — TUI component library for pi extensions

> Canonical import paths and component signatures for `@mariozechner/pi-tui`.

## Common operations

- Import layout components:
  `import { Container, Text, TruncatedText } from "@mariozechner/pi-tui"`

- Import selection UI:
  `import { type SelectItem, SelectList } from "@mariozechner/pi-tui"`

- Import key handling:
  `import { matchesKey, type KeyId } from "@mariozechner/pi-tui"`

- Import text utilities:
  `import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui"`

- Import fuzzy matching:
  `import { fuzzyFilter, fuzzyMatch } from "@mariozechner/pi-tui"`

## Patterns

- Build an overlay component:
  return `{ render(width): string[], invalidate(): void, handleInput(data): void }` from `ctx.ui.custom()`

- Use `Container` as the root, add `Text` children with `(content, paddingLeft, paddingTop)`:
  `const c = new Container(); c.addChild(new Text("hello", 1, 0));`

- Match keyboard input:
  `if (matchesKey(data, "escape")) done(null);`

- SelectList with callbacks:
  `const sl = new SelectList(items, maxVisible, theme); sl.onSelect = (item) => done(item.value); sl.onCancel = () => done(null);`

- Truncate with ANSI awareness:
  `truncateToWidth(styledText, availableWidth, "...", true)`

## Gotchas

- `Text` constructor is `(content, paddingLeft, paddingTop)` — NOT `(content, options)`
- `Container.addChild()` takes a `Component` — the `Component` interface requires `render(width): string[]` and `invalidate(): void`
- `SelectList` theme parameter uses callback functions: `selectedPrefix`, `selectedText`, `description`, `scrollInfo`, `noMatch`
- `matchesKey(data, keyId)` takes raw stdin data, not a parsed key object
- `visibleWidth()` strips ANSI before measuring — use it for layout math, not `string.length`
- `wrapTextWithAnsi()` wraps respecting ANSI escape sequences — plain `split` will break colors
- Do NOT import `Container`/`Text`/`DynamicBorder` from `@mariozechner/pi-coding-agent` — only `DynamicBorder` comes from there; `Container`/`Text` come from `@mariozechner/pi-tui`
- `DynamicBorder` is exported from `@mariozechner/pi-coding-agent`, not `@mariozechner/pi-tui`

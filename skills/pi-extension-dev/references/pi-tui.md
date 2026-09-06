# Pi TUI Components

Checked against the repository's `@earendil-works/pi-tui` 0.84.4 declarations.
Read the installed coding-agent `docs/tui.md` and linked examples before building
custom components. Keep theme, input, and rendering behavior tied to the injected
TUI context rather than global state.

## Imports and signatures

From `@earendil-works/pi-tui`:

- Layout: `Container`, `Text`, `TruncatedText`.
- Selection: `SelectList`, `SelectItem`, `SelectListTheme`.
- Keyboard: `matchesKey`, `KeyId`; pass raw stdin data to `matchesKey`.
- Text: `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`.
- Search: `fuzzyFilter`, `fuzzyMatch`.

`DynamicBorder` comes from `@earendil-works/pi-coding-agent`, **not** pi-tui.
Get the theme from the callback; `Theme` and `ThemeColor` types are exported by
coding-agent.

- `new Text(content, paddingX, paddingY, backgroundFn?)`: numeric horizontal and
  vertical padding, not an options object or left/top-only padding.
- `Container.addChild(component)`: requires `render(width): string[]` and
  `invalidate(): void`. `handleInput(data)` is optional for noninteractive components.
- `new SelectList(items, maxVisible, theme)`: theme callbacks are `selectedPrefix`,
  `selectedText`, `description`, `scrollInfo`, and `noMatch`.
- `truncateToWidth(text, width, "...", true)`: ANSI-aware truncation with padding.
  Use `visibleWidth`, not string length, for layout; use `wrapTextWithAnsi` for wrapping.

## Selection overlay

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("example-pick", {
    description: "Pick an example option",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      await ctx.ui.custom<string | null>((tui, theme, _keys, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        container.addChild(new Text("Pick one", 1, 0));
        const list = new SelectList([{ value: "one", label: "One" }], 1, {
          selectedPrefix: (s) => theme.fg("accent", s),
          selectedText: (s) => theme.fg("accent", s),
          description: (s) => theme.fg("muted", s),
          scrollInfo: (s) => theme.fg("dim", s),
          noMatch: (s) => theme.fg("warning", s),
        });
        list.onSelect = (item) => done(item.value);
        list.onCancel = () => done(null);
        container.addChild(list);
        return {
          render: (width) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data) => { list.handleInput(data); tui.requestRender(); },
        };
      }, { overlay: true });
    },
  });
}
```

## Rendering and lifecycle rules

- Never return lines wider than the supplied width; account for ANSI and wide characters.
- Forward keyboard input to the active child and request rendering after changes.
- Invalidate cached layout and rebuild pre-styled content when the theme changes.
- Create a fresh component when reopening an overlay; closed components are disposed.
- `ctx.hasUI` includes RPC dialogs, but custom terminal components require TUI mode.
- Preserve keyboard-only operation, confirmations, and non-color status cues.

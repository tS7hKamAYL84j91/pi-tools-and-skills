---
name: tui-design
description: Design, review, or implement terminal user interfaces. Use for TUI layout, screen modes, ANSI color, OSC sequences, Unicode graphics, animation, performance, accessibility fallbacks, and tmux-based testing.
---

# TUI Design

Use this skill when creating or reviewing terminal user interfaces. Treat the terminal as a character-cell grid, not a pixel canvas.

Source distilled from Toby's TUI Design Guide: https://gist.github.com/toby/bf1325449585be869a6b01a03d4cac44

## Design Principles

- **Embrace the grid:** every cell has one character, foreground color, background color, and attributes. Align deliberately; there is no sub-cell positioning.
- **Be a good terminal guest:** detect capabilities, respect user themes, clean up terminal state, and provide fallbacks.
- **Prefer intentional constraints:** small, consistent spacing and borders usually beat complex decoration.
- **Make waiting feel alive:** lightweight spinners, progress bars, and color transitions communicate responsiveness.
- **Design for degradation:** SSH, tmux, old macOS Terminal, and limited fonts should still be usable.

## Screen Mode Choice

Choose the screen buffer based on workflow:

| Use case | Mode | Why |
| --- | --- | --- |
| CLI output, logs, build/test results | Main screen | Output should remain in scrollback and support piping/redirection |
| Full-screen editors, dashboards, games | Alternate screen | App needs full control and should restore prior terminal contents |
| Inline pickers and selectors | Hybrid/main | Final context should remain visible after exit |

When using alternate screen, always restore on exit, interrupt, and termination.

```bash
printf '\e[?1049h'   # enter alternate screen
printf '\e[?1049l'   # exit alternate screen
trap 'printf "\e[?1049l"' EXIT INT TERM
```

## Color Guidance

- ANSI 16 colors are theme-dependent; do not assume exact RGB values.
- Use true color only when supported or when exact color matters.
- Test palettes on both light and dark backgrounds.
- Never rely on color alone for meaning; pair it with symbols, labels, or layout.
- Detect true color with `$COLORTERM == truecolor` or `$COLORTERM == 24bit`.

```bash
printf '\e[31mRed text\e[0m'              # ANSI 16
printf '\e[38;5;196mBright red\e[0m'      # 256-color
printf '\e[38;2;255;100;50mOrange\e[0m'   # RGB true color
```

## OSC Features

Use OSC sequences only with graceful fallback.

| Feature | Sequence | Use |
| --- | --- | --- |
| Hyperlink | OSC 8 | Clickable links in supported terminals |
| Background query | OSC 11 | Infer light/dark theme |
| Clipboard | OSC 52 | Clipboard integration, often filtered by tmux/terminal policy |

Fallback chain for theme detection: OSC 11 → `$COLORFGBG` → `$TERM_PROGRAM` hints → assume dark mode.

## Unicode Graphics

Prefer well-supported Unicode symbols and provide ASCII fallbacks.

```text
Light boxes:  ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼
Heavy boxes:  ━ ┃ ┏ ┓ ┗ ┛ ┣ ┫ ┳ ┻ ╋
Double boxes: ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬
Rounded:      ╭ ╮ ╰ ╯
Blocks:       █ ▀ ▄ ▌ ▐ ░ ▒ ▓
Braille:      ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
```

Avoid emoji in core layout: width, variation selectors, and rendering differ across terminals. Beware CJK/wide characters and missing glyphs. If alignment matters, measure display width or stick to safe characters.

Safe fallbacks:

```text
✓ -> *    ✗ -> x    ● -> @    → -> >    • -> -
```

## Performance Rules

For responsive TUIs, target event-driven rendering while idle and bounded animation when active.

- Update dirty rectangles only; avoid full redraws when a small region changed.
- Batch terminal writes; use one flush per frame when possible.
- Skip identical frames via diffing, hashing, or stable state checks.
- Avoid 60 FPS for static UI; render on input, resize, data changes, or animation ticks.
- Degrade gracefully under tmux, SSH, and slower terminals.

Frame budget at 60 FPS is 16.7 ms total, including app logic, diffing, ANSI generation, terminal I/O, and terminal rendering. Terminal I/O is usually the bottleneck.

## Animation Guidance

- Prefer color transitions for smoothness; character movement is cell-discrete and can look jumpy.
- Use motion sparingly to show liveness, progress, or state change.
- Suggested frame rates:
  - Spinners: 8–12 FPS
  - Progress bars: 4–10 FPS
  - Color cycling: 15–30 FPS
- Keep idle UI at 0 FPS; wake on input, resize, data change, or active animation.

Spinner options:

```text
Braille: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
Minimal: -\|/
Growing: ▁▂▃▄▅▆▇█
```

## Testing Checklist

Use tmux as the baseline integration test environment because it exposes common real-world issues with colors, OSC filtering, mouse input, and key timing.

```bash
tmux new-session -d -s tui-test -x 80 -y 24
tmux send-keys -t tui-test './my-tui' Enter
sleep 1
tmux capture-pane -t tui-test -p > screenshot.txt
tmux kill-session -t tui-test
```

Recommended tmux config for development:

```bash
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",*256col*:Tc"
set -g mouse on
set -sg escape-time 10
set -g set-clipboard on
```

Before shipping, verify:

- 80x24 layout and narrow-width behavior.
- Light and dark terminal themes.
- tmux and non-tmux rendering.
- True color disabled or unavailable.
- SSH or slower terminal behavior if relevant.
- Clean cursor, screen, and style reset after exit or crash.
- Keyboard-only operation and non-color status cues.

## Quick Reference

```text
\e[?1049h/l      alternate screen on/off
\e[2J            clear screen
\e[H             cursor home
\e[{r};{c}H      move to row, column
\e[?25l/h        hide/show cursor
\e[0m            reset attributes
\e[1m / \e[2m    bold / dim
\e[38;5;{n}m     256-color foreground
\e[38;2;r;g;bm   true-color foreground
```

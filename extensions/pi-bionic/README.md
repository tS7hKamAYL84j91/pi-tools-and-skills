# pi-bionic

Minimal local-only clean-room bionic-reading extension slice for T-249.

## Usage

- Tool: `bionic_text` transforms supplied plain text and returns marked output.
- Command: `/bionic-text <text>` shows a local preview notification.

Default markers are raw ANSI bold bytes (`\x1b[1m` / `\x1b[22m`) so tool output keeps emphasis even when not attached to a TTY. Pass `sepOpen` and `sepClose` for deterministic non-ANSI fixtures such as `[` and `]`.

## What this does NOT do

- Local transform only: no network, providers, keychains, persistence, or file reads/writes.
- First slice only: no overlay, file wrapper, auto-stream mode, or integration hooks yet.
- Clean-room basis: implemented from the T-245 observable-behaviour spec and T-247 certification; no upstream/proprietary source, tests, transcripts, or worker logs were used.

## Verification

Tests cover simple text, punctuation/whitespace, empty input, digits, custom markers, and extension registration. Follow-ups: add overlay, file entrypoint, richer fixation tables, and integration hooks after this minimal slice lands.

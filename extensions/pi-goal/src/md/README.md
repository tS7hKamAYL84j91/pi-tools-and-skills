# pi-goal source Markdown

This directory is a pilot for Markdown that captures only source-level intent
next to the extension source. Higher-level rationale remains in `docs/adr/049-*`,
`051-*`, `055-*`, `059-*`, `docs/architecture.md`, and the public extension
README. These files are not generated documentation and do not replace tests.

- `OVERVIEW.md` — stable architectural intent and invariants.
- `features/goal-loop.md` — behavior-level contract for the execution loop.

Edit these files when behavior or invariants change; update the derived tests and
public README in the same change. Keep ephemeral prompts, transcripts, and
operator state out of this directory.

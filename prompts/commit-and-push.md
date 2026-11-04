---
description: Stage, commit, and push changes with a conventional commit message
---
Review the current working tree (`git status`, `git diff`), then:

## Pre-flight

- Record user-visible changes under `## [Unreleased]` in `CHANGELOG.md`, or state
  explicitly that no changelog entry is needed.
- Confirm `AGENTS.md` and the package READMEs still match the shipped surface.
- Leave unrelated work out of the commit rather than sweeping it in with `git add -A`.

## Steps

1. Stage all relevant changes (`git add -A` or selectively if unrelated files exist).
2. Write a concise **conventional commit** message:
   - Format: `<type>(<scope>): <summary>` — e.g. `fix(kanban): correct tie-breaking for T-NNN ids`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`
   - Keep the summary under 72 characters; add a body only if the why is non-obvious.
3. Commit: `git commit -m "<message>"`
4. Push: `git push`
5. Confirm success and print the commit hash.
6. Verify the working tree is clean (`git status --short`); report anything left behind.

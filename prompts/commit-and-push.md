---
description: Stage, commit, and push changes with a conventional commit message
---
Review the current working tree (`git status`, `git diff`), then:

1. Stage all relevant changes (`git add -A` or selectively if unrelated files exist).
2. Write a concise **conventional commit** message:
   - Format: `<type>(<scope>): <summary>` — e.g. `fix(kanban): correct tie-breaking for T-NNN ids`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`
   - Keep the summary under 72 characters; add a body only if the why is non-obvious.
3. Commit: `git commit -m "<message>"`
4. Push: `git push`
5. Confirm success and print the commit hash.

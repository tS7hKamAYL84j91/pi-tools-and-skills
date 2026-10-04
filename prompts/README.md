# Prompts

Reusable Pi slash-command templates. Each file is Markdown with frontmatter
`description`; Pi exposes it as `/name`. Root `package.json` loads this folder.

| Prompt | Command | Purpose |
| --- | --- | --- |
| `commit-and-push.md` | `/commit-and-push` | Stage, commit and push with a conventional message |
| `refactor.md` | `/refactor` | Bounded simplification that preserves behaviour |

# Skills

Reusable agent guidance. Each skill is a directory with a `SKILL.md` (frontmatter
`name` and `description`, then instructions).

Pi discovers these through the root package manifest (`"skills"` in
`package.json`). Extension-specific skills stay inside their extension.

| Skill | Purpose |
| --- | --- |
| `fire-review` | Focused code review |
| `tui-design` | Terminal UI design |

FIRE and TUI design are retained for external use. Fleet-specific Kanban guidance
remains bundled with `extensions/pi-kanban`; dormant guidance was removed rather
than retained solely because it had historical reads. Git history preserves it.

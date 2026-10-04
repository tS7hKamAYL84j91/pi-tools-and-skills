# Semgrep Rules

Custom Semgrep rules for agent-generated code review.

```sh
npm run security:semgrep
```

`custom/` holds the active rules: `unsafe-eval`, `secret-literals`,
`path-traversal`, and `command-injection`. Rules are scoped to reviewed source
and must fail on a concrete forbidden pattern, not style.

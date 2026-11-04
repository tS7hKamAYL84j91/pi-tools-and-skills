# Security

Personal repo, provided as-is under the [MIT license](LICENSE).

This is meant to run in a trusted environment. Pi runs in YOLO mode and nothing in this setup changes that — user beware :)

## Checks

- `make secret-scan` — gitleaks scan of git history and working tree.
- `make semgrep-scan` — custom Semgrep rules (`rules/custom/`).
- `make audit` — `npm audit --omit=dev --audit-level=high`.
- Keep secrets and live config out of the repo.

# Jules CLI quick reference

Sources inspected: `jules --help`, subcommand help for `new`, `remote list`, `remote pull`, `teleport`, and https://jules.google/docs/.

## Setup

```bash
npm install -g @google/jules
jules login
```

Jules also needs GitHub connected at https://jules.google.com/ for repository access.

## CLI commands

```bash
jules                      # launch TUI
jules new "task prompt"     # create a session for current repo
jules new --repo owner/repo "task prompt"
jules new --repo owner/repo --parallel 3 "task prompt"  # 1-5 parallel sessions
jules remote list --session
jules remote list --repo
jules remote pull --session SESSION_ID
jules remote pull --session SESSION_ID --apply
jules teleport SESSION_ID
```

`jules teleport SESSION_ID` clones/checks out/applies the session patch, or applies it to the current repo if it matches.

## GitHub Issue delegation

Docs say Jules can start tasks from GitHub Issues by applying the `jules` label, case-insensitive. Requirements:

- Jules GitHub app is authorized for the repo.
- Add label `jules` to the issue.
- Jules comments on the issue.
- When finished, Jules provides a PR link for review.

CLI helper:

```bash
skills/jules-delegation/scripts/jules-delegate.sh --repo owner/repo --issue 42 --label-only
```

## Review model

- Jules creates a plan before writing code.
- Plans can be reviewed/approved; docs note plans may eventually auto-approve if you navigate away.
- Jules works in a fresh cloud VM with internet access.
- Do not include secrets in prompts, repo files, setup scripts, or issue bodies.
- Long-lived commands like `npm run dev` are not supported in setup scripts; use discrete install/test commands.

## Pulling results

For CLI sessions, prefer reviewing before applying:

```bash
jules remote list --session
jules remote pull --session SESSION_ID
# inspect patch/output
jules remote pull --session SESSION_ID --apply
```

For PR-based issue work, watch PRs with GitHub CLI and review/merge normally.

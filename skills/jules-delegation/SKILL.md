---
name: jules-delegation
description: Delegate coding tasks to Google Jules and monitor resulting Jules sessions, GitHub issue handoffs, branches, and PRs. Use when asked to hand off work to Jules, run parallel Jules tasks, label GitHub issues for Jules, pull Jules results, or watch GitHub PRs created by Jules.
---

# Jules Delegation

Use this skill to hand suitable coding work to Google Jules and then monitor the outcome.

Jules is an asynchronous coding agent backed by GitHub. It works well for scoped repo tasks: tests, docs, refactors, bug fixes, and small features. Do **not** send secrets or broad/vague tasks.

## Prerequisites

Verify once per environment:

```bash
command -v jules || npm install -g @google/jules
jules login
jules remote list --repo
```

Jules must also be connected to GitHub at `https://jules.google.com/` and authorized for the target repo.

## Choosing the delegation mode

### Use CLI sessions for patch-oriented work

Use when you want Jules to produce a patch/session that you can pull locally:

```bash
jules new --repo owner/repo "Clear, scoped task prompt"
jules remote list --session
jules remote pull --session SESSION_ID
jules remote pull --session SESSION_ID --apply
jules teleport SESSION_ID
```

Helper:

```bash
skills/jules-delegation/scripts/jules-delegate.sh --repo owner/repo "Clear, scoped task prompt"
```

For divergent attempts, use parallel sessions, max 5:

```bash
skills/jules-delegation/scripts/jules-delegate.sh --repo owner/repo --parallel 3 "Try three approaches to simplify X; include tests."
```

### Use GitHub issue labels for PR-oriented work

Use when you want Jules to work from an issue and produce/comment a PR:

```bash
gh issue edit ISSUE_NUMBER --repo owner/repo --add-label jules
```

Helper:

```bash
skills/jules-delegation/scripts/jules-delegate.sh --repo owner/repo --issue 42 --label-only
```

Docs say Jules will comment on the issue and provide a PR link when finished.

## Prompt pattern

Send Jules a self-contained brief:

```text
Goal: ...
Repo/branch: ...
Scope: files/directories in scope; explicit out of scope
Acceptance criteria:
- tests/commands to run
- behavior expected
Constraints:
- do not change public API unless necessary
- do not add secrets
Deliverable: patch/PR with summary and tests run
```

Keep tasks small. Avoid “fix everything”, “make it better”, or multi-project orchestration.

## Monitoring

Watch Jules sessions:

```bash
jules remote list --session
```

Watch sessions and GitHub PRs together:

```bash
skills/jules-delegation/scripts/jules-watch.sh --repo owner/repo --interval 60
```

For issue-based handoff:

```bash
skills/jules-delegation/scripts/jules-watch.sh --repo owner/repo --issue 42 --interval 60
```

When a PR appears, inspect it normally:

```bash
gh pr view PR_NUMBER --repo owner/repo --web
gh pr checks PR_NUMBER --repo owner/repo
gh pr diff PR_NUMBER --repo owner/repo
```

## Pulling and reviewing CLI session results

1. List sessions and identify `SESSION_ID`:

   ```bash
   jules remote list --session
   ```

2. Pull without applying first when possible:

   ```bash
   jules remote pull --session SESSION_ID
   ```

3. Apply only after review:

   ```bash
   jules remote pull --session SESSION_ID --apply
   ```

4. Or teleport:

   ```bash
   jules teleport SESSION_ID
   ```

5. Run local tests and code review before merge.

## Safety rules

- Do not send secrets, private credentials, tokens, or unredacted logs.
- Remember Jules runs code in a cloud VM with internet access.
- Prefer discrete setup/test commands; Jules docs say long-running dev servers/watch scripts are not supported in setup scripts.
- Treat Jules output like any external contributor PR: review diffs, run tests, inspect dependency changes.
- If Jules is stuck at “Awaiting User Feedback”, open the Jules UI or relevant issue/PR and answer with concrete guidance.

## References

See [Jules CLI quick reference](references/jules-cli.md) for command details and docs notes.

# T-570 Public Template-Pack Placeholders and Private-Data Linting Policy

Date: 2026-05-28
State: design-only specification
Owner: pi-tools-and-skills

## Goal

Define a bounded policy for public/reusable template and policy packs so they can be reviewed without exposing private operational data. This report is intentionally design-only: it does not add a linter, CLI, CI gate, runtime enforcement, repo-wide scan, or mutation behavior.

## Public template-pack placeholder conventions

Public packs must be safe to publish as-is. They should use synthetic examples or named placeholders instead of raw private values.

Allowed placeholder forms:

- Angle-bracket placeholders for required user substitution: `<WORKSPACE_NAME>`, `<ROOM_ID>`, `<CONTACT_EMAIL>`.
- Clearly fake domains and addresses: `example.com`, `user@example.com`, `team@example.com`.
- Synthetic IDs with explicit prefixes: `agent-example-001`, `task-example-123`, `room-example-ops`.
- Redacted shape-preserving examples when a format matters: `ghp_<REDACTED_EXAMPLE_TOKEN>`, `sk-<REDACTED_EXAMPLE_KEY>`.
- Neutral paths that cannot identify a person or host: `/path/to/workspace`, `/tmp/pi-example`.

Redacted credential-shaped examples are allowed only in explanatory documentation; runnable config, literal authorization headers, and defaults must use named placeholders instead.

Forbidden in public packs:

- Raw tokens, API keys, cookies, OAuth codes, SSH/private keys, passphrases, or authorization headers.
- Real phone numbers, personal emails, home directories, hostnames, Matrix room IDs, customer names, incident IDs, ticket URLs, or workspace paths.
- Private board state, session transcripts, logs, operational summaries, or model responses copied from live work.
- Hidden defaults that silently point to private infrastructure.

## Private-data lint categories

A future lint pass should classify findings before deciding whether to block, warn, or ignore. Examples below are synthetic only.

| Category | Example violation | Non-violation |
|---|---|---|
| Credential material | `Authorization: Bearer ghp_<REDACTED_EXAMPLE_TOKEN>` if presented as a real value | `Authorization: Bearer <ACCESS_TOKEN>` |
| Secret assignment | `api_key=sk-<REDACTED_EXAMPLE_KEY>` in runnable config | `api_key=<API_KEY>` |
| Personal data | `operator_phone=+15550101111` | `operator_phone=<PHONE_NUMBER>` |
| Private routing | `matrix_room=!examplePrivateRoom:example.com` | `matrix_room=<MATRIX_ROOM_ID>` |
| Local identity/path | `/home/alice/private-client/workspace` | `/path/to/workspace` |
| Live operational state | pasted task notes, session logs, or incident summaries | short synthetic scenario text |
| Customer/project identity | `customer=ExampleCorp-private` when it names a real account | `customer=<CUSTOMER_NAME>` |

Potential severity model:

- **Block:** credential-like material, private keys, authorization headers, live tokens, real private logs, or runnable private endpoints.
- **Warn:** probable PII, local paths, room IDs, internal ticket URLs, hostnames, or unclear synthetic values.
- **Allow:** explicit placeholders, `example.com`, synthetic IDs, and redacted examples that cannot authenticate or identify a real person/system.

## Required sections for public/reusable packs

Every public template or policy pack should include these sections before distribution:

1. **Purpose and audience** — what the pack helps operators do.
2. **Inputs to replace** — a checklist of every placeholder, its expected shape, and whether it is required.
3. **Public-safety statement** — confirmation that examples are synthetic and contain no live credentials, private logs, or personal data.
4. **No-go gates** — conditions that prevent publication.
5. **Review evidence** — reviewer, date, and checks performed.
6. **Runtime boundary** — whether the pack is documentation-only, prompt/template input, or executable configuration.
7. **Escalation path** — who approves changes that add public contracts or enforcement.

Minimum no-go gates:

- Any credential, token, private key, cookie, or authorization header appears outside a named placeholder.
- Any real person, customer, workspace, room, host, incident, or ticket identifier appears in examples.
- The pack contains copied live logs, session transcripts, board state, or operational summaries.
- A template can mutate files, call external services, or enable runtime behavior without a separate implementation approval.
- A reviewer cannot tell which values are placeholders and which are literal defaults.

## Design-only sample snippets

Acceptable public template excerpt:

```md
Workspace: <WORKSPACE_NAME>
Contact: team@example.com
Matrix room: <MATRIX_ROOM_ID>
Token source: environment variable `<SERVICE_TOKEN_ENV>`
Local path: /path/to/workspace
```

Unacceptable public template excerpt:

```md
Workspace: private-customer-launch
Contact: alice@example.net
Matrix room: !not-a-real-room-but-shaped-like-private:example.com
Authorization: Bearer ghp_<REDACTED_EXAMPLE_TOKEN>
Local path: /home/alice/private-customer-launch
```

The second excerpt is unacceptable even though the token text is redacted, because it mixes realistic private identity, routing, and local path values in a public-facing pack.

## Future linter/enforcement placement

If approved later, implementation should be added as a small docs/package validation utility rather than runtime extension behavior:

- likely location: `scripts/` for a package-level checker and `tests/` for focused fixtures;
- optional npm script after approval: a named check such as `check:template-safety`;
- reusable rule definitions may live under `lib/` only if consumed by multiple checked surfaces;
- extension runtime code should not scan, delete, rewrite, or redact user files automatically.

The first implementation ticket should be docs-fixture based: detect obvious credential/PII/private-path markers in explicitly listed public template-pack paths and report deterministic findings without modifying files.

## ADR and approval triggers

Require an ADR or explicit approval before any future work that:

- defines a public placeholder schema as a compatibility contract;
- adds CI or pre-commit blocking gates;
- performs repo-wide or workspace-wide private-data scanning;
- reads credentials, keychains, session stores, Matrix data, kanban state, or working-notes;
- mutates, redacts, deletes, renames, or quarantines files;
- adds runtime extension enforcement or model-visible tools/commands;
- sends findings to external services or provider-backed tools;
- changes package distribution policy for public template packs.

## Out of scope

No implementation, no linter, no tests, no CLI, no CI gate, no runtime enforcement, no repo-wide scan, no external services, no provider-backed tools, no real private examples, and no mutation of working-notes, `.workers`, secrets, session data, or kanban state.

# ADR 017: Gmail OAuth, token storage, and read-only boundary

## Status
Accepted

## Context

`pi-gmail` provides live Gmail access for model-assisted inbox triage. The safe initial use case is read-only search and message lookup, not mailbox mutation or background indexing.

## Decision

1. Use only `https://www.googleapis.com/auth/gmail.readonly`.
2. Read OAuth client JSON and refresh token from environment variables or a configurable secret helper command (`PI_GMAIL_SECRET_COMMAND`, `COAS_SECRETS_COMMAND`, or `COAS_SECRETS`; default executable name: `coas-secrets`).
3. Mint short-lived access tokens on demand, cache them in process memory only, and never persist access tokens.
4. Verify minted access tokens with Google tokeninfo and refuse access unless the token has exactly the Gmail readonly scope.
5. Expose only `gmail_search` and `gmail_get_message`; both fetch Gmail metadata/snippets only.
6. Treat OAuth consent plus explicit model tool invocation as the authorization boundary. There is no extra `ctx.ui.confirm` prompt so noninteractive validation and agent runs do not hang.
7. Wrap returned Gmail-derived text in `<external_email>...</external_email>` tags.
8. Keep the extension under `extensions/pi-gmail/` with an extension-local `package.json`.

## Consequences

- Live Gmail reads are limited to metadata/snippet access and cannot mutate mailbox state.
- Operators must provide either explicit environment secrets or a compatible `secret-helper get <name>` command.
- Snippets, subjects, and addresses are still mailbox-derived PII; callers must avoid logging or committing outputs.

## Related Decisions

- ADR 015: Matrix attachment ingestion — external content is wrapped and treated as untrusted.

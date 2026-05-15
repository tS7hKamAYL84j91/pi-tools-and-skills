# pi-gmail

Read-only Gmail extension for pi.

## Status

- Uses only `https://www.googleapis.com/auth/gmail.readonly`.
- Reads OAuth material from environment variables or a configurable secret helper command (`PI_GMAIL_SECRET_COMMAND`, `COAS_SECRETS_COMMAND`, or `COAS_SECRETS`; default: `coas-secrets`).
- Exchanges the refresh token for short-lived access tokens on demand; access tokens are cached in memory only.
- Refuses access unless Google tokeninfo reports exactly the readonly Gmail scope.

## Tools

- `gmail_search`
  - Parameters: `query`, optional `maxResults` capped at 50.
  - Calls Gmail read-only list plus metadata fetch.
  - Returns id, threadId, from, date, subject, and snippet.
- `gmail_get_message`
  - Parameter: `id`.
  - Fetches metadata/snippet for the explicit message ID.

Outputs are wrapped in `<external_email>...</external_email>`. The extension does not send, modify, delete, archive, label, draft, or otherwise mutate Gmail.

## Credentials

Required secrets, supplied by environment or secret helper:

- `gmail-oauth-client`: Google OAuth client JSON, either desktop/web Google format or direct `{ client_id, client_secret }`.
- `gmail-refresh-token`: user refresh token with exactly the Gmail readonly scope.

Environment overrides:

- `GMAIL_OAUTH_CLIENT_JSON`
- `GMAIL_REFRESH_TOKEN`
- `PI_GMAIL_SECRET_COMMAND`
- `COAS_SECRETS_COMMAND`
- `COAS_SECRETS`

Do not print or commit these values.

## Validation

Default validation is offline and mocked:

```bash
npm run check
npm test
```

Manual live smoke, using configured credentials, should search a small bounded query such as `in:inbox newer_than:1d` with `maxResults: 3` and fetch metadata/snippet only.

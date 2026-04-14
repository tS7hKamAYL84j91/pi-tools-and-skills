#!/usr/bin/env bash
#
# matrix-login.sh — rotate the bot's Matrix access token.
#
# Logs in with the bot's password (from secret store), prints the new
# token, and optionally stores it in the secret store.
#
# Usage:
#   scripts/matrix-login.sh                    # uses TS_FQDN from .env
#   scripts/matrix-login.sh --store            # store the new token automatically

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRETS="${COAS_SECRETS_WRAPPER:-${TOOLS_DIR}/scripts/coas-secrets.sh}"
STORE=false

[[ "${1:-}" == "--store" ]] && STORE=true

# Resolve homeserver from .env
if [[ -f "${TOOLS_DIR}/coas-infra/.env" ]]; then
  # shellcheck disable=SC1091
  source "${TOOLS_DIR}/coas-infra/.env"
fi

: "${TS_FQDN:?TS_FQDN not set — add it to coas-infra/.env}"
HOMESERVER="https://${TS_FQDN}"
BOT_USER="coas-bot"

# Get password from secret store
BOT_PASSWORD="$("${SECRETS}" get bot-password 2>/dev/null)" || {
  echo "error: bot-password not in secret store" >&2
  exit 1
}

# Login
RESPONSE="$(curl -sf -X POST "${HOMESERVER}/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"m.login.password\",
    \"identifier\": {\"type\": \"m.id.user\", \"user\": \"${BOT_USER}\"},
    \"password\": \"${BOT_PASSWORD}\",
    \"initial_device_display_name\": \"CoAS Chief of Staff (extension)\"
  }")" || {
  echo "error: login failed" >&2
  exit 1
}

TOKEN="$(echo "${RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")"
DEVICE="$(echo "${RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['device_id'])")"

echo "✓ Login successful (device: ${DEVICE})" >&2

if [[ "${STORE}" == "true" ]]; then
  echo "${TOKEN}" | "${SECRETS}" set matrix-token
  echo "✓ Stored as matrix-token" >&2
else
  echo "${TOKEN}"
  echo "" >&2
  echo "To store: echo '${TOKEN}' | ${SECRETS} set matrix-token" >&2
fi

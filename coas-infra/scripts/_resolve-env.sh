# shellcheck shell=bash
#
# _resolve-env.sh — shared environment-resolution helper.
#
# SOURCED (not executed) by all the coas-* helper scripts. Resolves
# secrets from the host secret store and exports the env vars docker
# compose needs to interpolate the compose file. Validates required
# values and fails fast with clear errors.
#
# Why a sourced lib instead of duplicating the logic in each script:
# every helper that calls `docker compose <subcommand>` needs the same
# env vars set, because compose validates the entire compose file on
# every subcommand (logs, ps, down, exec, etc.) — not just `up`. The
# `${VAR:?}` interpolation in docker-compose.yml fires on missing
# values regardless of which subcommand you're running.
#
# Required vs soft-required:
#   TS_AUTHKEY        — REQUIRED. The tailscale container won't start
#                       without it, and tailscale is the netns owner
#                       for caddy. The whole stack depends on it.
#   MATRIX_ACCESS_TOKEN — SOFT-REQUIRED. Only the coas-agent service
#                       consumes this. If missing, we set a placeholder
#                       and print a warning. Useful for the staged
#                       walkthrough where you bring up the homeserver
#                       to provision accounts BEFORE you have a token.
#
# Side effects:
#   - exports MATRIX_ACCESS_TOKEN, TS_AUTHKEY, MATRIX_RECOVERY_PASSPHRASE,
#     TS_HOSTNAME, TS_FQDN, GIT_ROOT, PI_STATE_DIR
#   - changes directory to INFRA_DIR
#
# Sets COAS_RESOLVED_ENV=1 to mark the env as resolved (idempotent —
# sourcing twice is a no-op).

if [[ "${COAS_RESOLVED_ENV:-0}" == "1" ]]; then
  return 0
fi

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="${COAS_SECRETS_WRAPPER:-${INFRA_DIR}/../scripts/coas-secrets.sh}"

if [[ ! -x "${SECRETS}" ]]; then
  echo "coas: cannot find coas-secrets.sh at ${SECRETS}" >&2
  echo "  set COAS_SECRETS_WRAPPER to its absolute path" >&2
  return 1
fi

# Source .env from the infra dir if present (for TS_HOSTNAME/TS_FQDN/etc).
# Done first so any override of GIT_ROOT etc. is honoured.
if [[ -f "${INFRA_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INFRA_DIR}/.env"
  set +a
fi

# ── Required: tailscale-authkey ──────────────────────────────────
# Stack can't start without it.
if ! TS_AUTHKEY="$("${SECRETS}" get tailscale-authkey 2>&1)"; then
  echo "coas: ERROR — tailscale-authkey not found in secret store" >&2
  echo "${TS_AUTHKEY}" >&2
  echo "" >&2
  echo "  Store it with:" >&2
  echo "    echo 'tskey-auth-...' | ${SECRETS} set tailscale-authkey" >&2
  echo "" >&2
  echo "  Generate one at https://login.tailscale.com/admin/settings/keys" >&2
  return 1
fi
if [[ -z "${TS_AUTHKEY}" ]]; then
  echo "coas: ERROR — tailscale-authkey is empty" >&2
  return 1
fi
export TS_AUTHKEY

# ── Soft-required: matrix-token ──────────────────────────────────
# Only the coas-agent service consumes it. If missing, set a placeholder
# so docker compose can still parse the file for `logs`, `down`, `ps`,
# or partial `up` of just continuwuity/tailscale/caddy.
#
# If the coas-agent service is later started with this placeholder, the
# matrix extension will fail at startup with a clear error in pi's logs.
if MATRIX_ACCESS_TOKEN="$("${SECRETS}" get matrix-token 2>/dev/null)"; then
  export MATRIX_ACCESS_TOKEN
else
  if [[ "${COAS_QUIET:-0}" != "1" ]]; then
    echo "coas: warning — matrix-token not in secret store (using placeholder)" >&2
    echo "       coas-agent will fail to connect to matrix until you store it:" >&2
    echo "         echo 'syt_...' | ${SECRETS} set matrix-token" >&2
  fi
  export MATRIX_ACCESS_TOKEN="PLACEHOLDER_NO_TOKEN_STORED"
fi

# ── Optional: matrix-recovery ────────────────────────────────────
# Used by Element X's Secure Backup feature. Empty if not configured.
if MATRIX_RECOVERY_PASSPHRASE="$("${SECRETS}" get matrix-recovery 2>/dev/null)"; then
  export MATRIX_RECOVERY_PASSPHRASE
else
  export MATRIX_RECOVERY_PASSPHRASE=""
fi

# ── Required: TS_FQDN ────────────────────────────────────────────
# Caddy uses it as the TLS cert name; .well-known/matrix/client returns it.
: "${TS_HOSTNAME:=coas-matrix}"
if [[ -z "${TS_FQDN:-}" ]]; then
  echo "coas: ERROR — TS_FQDN not set" >&2
  echo "  Add TS_FQDN=coas-matrix.<your-tailnet>.ts.net to ${INFRA_DIR}/.env" >&2
  echo "  Find your tailnet's MagicDNS name at https://login.tailscale.com/admin/dns" >&2
  return 1
fi

# ── Defaults: GIT_ROOT, PI_STATE_DIR ─────────────────────────────
: "${GIT_ROOT:=${HOME}/git}"
: "${PI_STATE_DIR:=${HOME}/.pi}"
export TS_HOSTNAME TS_FQDN GIT_ROOT PI_STATE_DIR

# ── Sanity: coas repo exists at GIT_ROOT/coas ────────────────────
if [[ ! -d "${GIT_ROOT}/coas" ]]; then
  echo "coas: ERROR — ${GIT_ROOT}/coas does not exist" >&2
  echo "  GIT_ROOT must be the parent of the coas repo" >&2
  echo "  Override via GIT_ROOT in .env if your layout differs" >&2
  return 1
fi

cd "${INFRA_DIR}" || return 1

export COAS_RESOLVED_ENV=1

#!/usr/bin/env bash
#
# coas-secrets — read secrets from the platform-native secret store and
# print them to stdout. One secret per call. Used by coas-up to populate
# environment variables before `docker compose up` without ever putting
# secrets on disk.
#
# macOS:  secrets live in the login Keychain via `security`.
# Linux:  secrets live in `pass` (passwordstore.org), gpg-backed.
#
# Usage:
#   coas-secrets get matrix-token
#   coas-secrets get matrix-recovery
#   coas-secrets get tailscale-authkey
#
#   coas-secrets set matrix-token        # prompts on stdin
#
# Layout (the keys are the same on both platforms; the storage backend
# is the only thing that differs):
#
#   matrix-token       — bot access token (`syt_...`)
#   matrix-recovery    — Secure Backup recovery passphrase (optional)
#   tailscale-authkey  — Tailscale node preauth key (`tskey-auth-...`)

set -euo pipefail

# ── Backend detection ─────────────────────────────────────────────

OS="$(uname -s)"

# All secrets are namespaced under "coas/" or service "coas" depending
# on backend conventions. Override via COAS_SECRETS_NAMESPACE if needed.
NAMESPACE="${COAS_SECRETS_NAMESPACE:-coas}"

# Known secret keys used by the CoAS stack. Used by the `list` command to
# probe each one and report whether it's stored. Add new keys here as
# new secret types are introduced.
KNOWN_KEYS="tailscale-authkey matrix-token matrix-recovery"

case "${OS}" in
  Darwin)  BACKEND=keychain ;;
  Linux)   BACKEND=pass ;;
  *)
    echo "coas-secrets: unsupported OS '${OS}'" >&2
    exit 2
    ;;
esac

# ── Backend implementations ───────────────────────────────────────

backend_get_keychain() {
  local key="$1"
  # -a account, -s service, -w print password only
  if ! security find-generic-password -a "${NAMESPACE}" -s "${key}" -w 2>/dev/null; then
    echo "coas-secrets: no Keychain entry for ${NAMESPACE}/${key}" >&2
    echo "  add it with: coas-secrets set ${key}" >&2
    return 1
  fi
}

backend_set_keychain() {
  local key="$1"
  local value="$2"
  # -U updates if it already exists, otherwise creates
  security add-generic-password -a "${NAMESPACE}" -s "${key}" -w "${value}" -U
}

backend_get_pass() {
  local key="$1"
  if ! pass "${NAMESPACE}/${key}" 2>/dev/null; then
    echo "coas-secrets: no pass entry for ${NAMESPACE}/${key}" >&2
    echo "  add it with: coas-secrets set ${key}" >&2
    return 1
  fi
}

backend_set_pass() {
  local key="$1"
  local value="$2"
  printf '%s\n' "${value}" | pass insert -e "${NAMESPACE}/${key}"
}

# ── Dispatch ──────────────────────────────────────────────────────

cmd="${1:-}"
key="${2:-}"

case "${cmd}" in
  get)
    if [[ -z "${key}" ]]; then
      echo "usage: coas-secrets get <key>" >&2
      exit 1
    fi
    case "${BACKEND}" in
      keychain) backend_get_keychain "${key}" ;;
      pass)     backend_get_pass "${key}" ;;
    esac
    ;;

  set)
    if [[ -z "${key}" ]]; then
      echo "usage: coas-secrets set <key>  (value read from stdin)" >&2
      exit 1
    fi
    if [[ -t 0 ]]; then
      printf 'Enter value for %s/%s: ' "${NAMESPACE}" "${key}" >&2
      stty -echo
      read -r value
      stty echo
      printf '\n' >&2
    else
      read -r value
    fi
    case "${BACKEND}" in
      keychain) backend_set_keychain "${key}" "${value}" ;;
      pass)     backend_set_pass "${key}" "${value}" ;;
    esac
    echo "coas-secrets: stored ${NAMESPACE}/${key} in ${BACKEND}" >&2
    ;;

  list)
    # macOS Keychain has no native "list all entries for an account" CLI,
    # so we probe each known key explicitly. `pass` does support listing.
    case "${BACKEND}" in
      keychain)
        echo "coas-secrets in namespace '${NAMESPACE}' (macOS Keychain):" >&2
        found=0
        for k in ${KNOWN_KEYS}; do
          if security find-generic-password -a "${NAMESPACE}" -s "${k}" >/dev/null 2>&1; then
            printf '  ✓ %s\n' "${k}"
            found=$((found + 1))
          else
            printf '  ✗ %s (not stored)\n' "${k}"
          fi
        done
        if [[ ${found} -eq 0 ]]; then
          echo "" >&2
          echo "No coas-secrets stored yet in namespace '${NAMESPACE}'." >&2
          echo "Store one with: echo 'value' | coas-secrets set <key>" >&2
        fi
        ;;
      pass)
        echo "coas-secrets in namespace '${NAMESPACE}' (pass):" >&2
        if pass ls "${NAMESPACE}/" 2>/dev/null; then
          :  # pass already printed the tree
        else
          echo "  (no entries)" >&2
        fi
        ;;
    esac
    ;;

  ""|-h|--help|help)
    cat <<'USAGE' >&2
coas-secrets — platform-agnostic secret store wrapper

usage:
  coas-secrets get <key>      print the secret to stdout
  coas-secrets set <key>      store a secret (reads from stdin)
  coas-secrets list           list known keys

backends:
  macOS  → login Keychain (via `security`)
  Linux  → pass            (via `pass`, gpg-backed)

namespace: $COAS_SECRETS_NAMESPACE  (default: coas)

example:
  echo 'syt_abc123' | coas-secrets set matrix-token
  coas-secrets get matrix-token
USAGE
    [[ "${cmd}" == "" ]] && exit 1 || exit 0
    ;;

  *)
    echo "coas-secrets: unknown command '${cmd}' (try --help)" >&2
    exit 1
    ;;
esac

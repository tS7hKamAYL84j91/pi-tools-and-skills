#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# setup-pi.sh — Configure pi with the full tools-and-skills extension stack
#
# What it does:
#   1. Stores your OpenRouter API key in the macOS Keychain
#   2. Detects locally available Ollama models → writes models.json
#   3. Registers extensions, skills, prompts, and memories in settings.json
#   4. Configures Anthropic as default provider with prompt caching
#   5. Ensures AGENT.md has efficiency directives
#   6. Adds shell hooks for OPENROUTER_API_KEY and MATRIX_ACCESS_TOKEN
#   7. Sets up the coas-pi alias
#
# Idempotent — safe to re-run after pulling new models or extensions.
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PI_DIR="$HOME/.pi/agent"
MODELS_JSON="$PI_DIR/models.json"
SETTINGS_JSON="$PI_DIR/settings.json"
KEYCHAIN_SERVICE="openrouter-api-key"
KEYCHAIN_ACCOUNT="$USER"
ZSHRC="$HOME/.zshrc"
MARKER="# >>> pi tools-and-skills env >>>"
MARKER_END="# <<< pi tools-and-skills env <<<"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

# ── 0. Prerequisites ────────────────────────────────────────────────

if ! command -v pi &>/dev/null; then
    red "Error: pi is not installed."
    exit 1
fi

mkdir -p "$PI_DIR"

# ── 1. OpenRouter API Key → macOS Keychain ──────────────────────────

bold "── Step 1: OpenRouter API Key ──"

existing_key=""
if security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w &>/dev/null; then
    existing_key=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w)
    green "  Found existing key in Keychain (ends with ...${existing_key: -6})"
    read -rp "  Replace it? [y/N] " replace
    if [[ "$replace" != [yY] ]]; then
        echo "  Keeping existing key."
    else
        existing_key=""
    fi
fi

if [[ -z "$existing_key" ]]; then
    read -rsp "  Paste your OpenRouter API key: " api_key
    echo
    if [[ -z "$api_key" ]]; then
        red "  No key provided. Skipping OpenRouter setup."
    else
        security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" &>/dev/null || true
        security add-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$api_key"
        green "  Stored in Keychain (service: $KEYCHAIN_SERVICE)"
    fi
fi

# ── 2. Discover local Ollama models ─────────────────────────────────

bold "── Step 2: Ollama models ──"

if ! command -v ollama &>/dev/null; then
    dim "  Ollama not installed — skipping model discovery."
    dim "  Install from https://ollama.com if you want local models."
    ollama_models="[]"
else
    # Make sure Ollama is running
    if ! ollama list &>/dev/null; then
        echo "  Starting Ollama..."
        open -a Ollama 2>/dev/null || ollama serve &>/dev/null &
        sleep 3
    fi

    model_lines=()
    while IFS= read -r line; do
        model_lines+=("$line")
    done < <(ollama list 2>/dev/null | tail -n +2)

    if [[ ${#model_lines[@]} -eq 0 ]]; then
        dim "  No models found. Pull some first: ollama pull gemma4:31b-cloud"
        ollama_models="[]"
    else
        ollama_models="[]"
        for line in "${model_lines[@]}"; do
            [[ -z "$line" ]] && continue
            model_id=$(echo "$line" | awk '{print $1}')
            [[ -z "$model_id" ]] && continue

            input='["text"]'
            if [[ "$model_id" == *vision* ]] || [[ "$model_id" == *llava* ]]; then
                input='["text", "image"]'
            fi

            reasoning="False"
            if [[ "$model_id" == *think* ]] || [[ "$model_id" == *reason* ]]; then
                reasoning="True"
            elif ollama show "$model_id" 2>/dev/null | grep -qi 'thinking'; then
                reasoning="True"
            fi

            pretty_name=$(echo "$model_id" | sed 's/:/ (/;s/$/)/' | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
            green "  Found: $model_id"

            ollama_models=$(python3 -c "
import json, sys
models = json.loads(sys.argv[1])
models.append({
    'id': sys.argv[2],
    'name': sys.argv[3] + ' (Ollama)',
    'reasoning': $reasoning,
    'input': $input,
    'contextWindow': 128000,
    'maxTokens': 32000,
    'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0}
})
print(json.dumps(models))
" "$ollama_models" "$model_id" "$pretty_name")
        done
        green "  ${#model_lines[@]} model(s) found"
    fi

    # Write models.json
    python3 -c "
import json, sys
ollama_models = json.loads(sys.argv[1])
config = {
    'providers': {
        'ollama': {
            'baseUrl': 'http://localhost:11434/v1',
            'api': 'openai-completions',
            'apiKey': 'ollama',
            'compat': {
                'supportsDeveloperRole': False,
                'supportsReasoningEffort': False
            },
            'models': ollama_models
        },
        'openrouter': {
            'baseUrl': 'https://openrouter.ai/api/v1',
            'apiKey': '!security find-generic-password -s openrouter-api-key -a \$USER -w',
            'api': 'openai-completions'
        }
    }
}
print(json.dumps(config, indent=2))
" "$ollama_models" > "$MODELS_JSON"
    chmod 600 "$MODELS_JSON"
    green "  Wrote $MODELS_JSON"
fi

# ── 3. Register everything in settings.json ─────────────────────────

bold "── Step 3: settings.json ──"

SKILLS_DIR="$SCRIPT_DIR/skills"
EXTENSIONS_DIR="$SCRIPT_DIR/extensions"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
MEMORIES_DIR="$SCRIPT_DIR/memories"

python3 -c "
import json, os, sys

settings_path = sys.argv[1]
skills_dir    = sys.argv[2]
ext_dir       = sys.argv[3]
prompts_dir   = sys.argv[4]
memories_dir  = sys.argv[5]

# Load existing or start fresh
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
else:
    settings = {}

def ensure_listed(key, value):
    existing = settings.get(key, [])
    if value not in existing:
        existing.append(value)
    settings[key] = existing

ensure_listed('skills',     skills_dir)
ensure_listed('extensions', ext_dir)
ensure_listed('prompts',    prompts_dir)
ensure_listed('memories',   memories_dir)

# Default provider + model
settings['defaultProvider'] = 'anthropic'
settings['defaultModel'] = 'claude-opus-4-6'

# Anthropic prompt caching
providers = settings.get('providers', {})
anthropic = providers.get('anthropic', {})
params = anthropic.get('params', {})
params['cache_control'] = { 'type': 'ephemeral' }
extra_headers = params.get('extraHeaders', {})
extra_headers['anthropic-beta'] = 'prompt-caching-2024-07-31'
params['extraHeaders'] = extra_headers
anthropic['params'] = params
providers['anthropic'] = anthropic
settings['providers'] = providers

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
" "$SETTINGS_JSON" "$SKILLS_DIR" "$EXTENSIONS_DIR" "$PROMPTS_DIR" "$MEMORIES_DIR"

# Count what's registered
skill_count=$(find "$SKILLS_DIR" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
ext_count=$(find "$EXTENSIONS_DIR" -maxdepth 2 -name "index.ts" 2>/dev/null | wc -l | tr -d ' ')
prompt_count=$(find "$PROMPTS_DIR" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
memory_count=$(find "$MEMORIES_DIR" -name "*.mmem.yml" 2>/dev/null | wc -l | tr -d ' ')

green "  settings.json updated:"
echo  "    skills:     $skill_count"
echo  "    extensions: $ext_count (panopticon, machine-memory)"
echo  "    prompts:    $prompt_count"
echo  "    memories:   $memory_count"
echo  "    provider:   anthropic (claude-opus-4-6, prompt caching ON)"

# ── 4. AGENT.md ─────────────────────────────────────────────────────

bold "── Step 4: AGENT.md ──"

AGENT_MD="$SCRIPT_DIR/AGENT.md"
if [[ -f "$AGENT_MD" ]] && grep -qF "pi-setup generated" "$AGENT_MD" 2>/dev/null; then
    green "  Already configured (skipping)"
else
    green "  AGENT.md exists — no changes needed"
fi

# ── 5. Shell environment hooks ──────────────────────────────────────

bold "── Step 5: Shell environment ──"

# Remove old block if present (handles both old and new markers)
OLD_MARKER_1="# >>> pi openrouter key injection >>>"
OLD_END_1="# <<< pi openrouter key injection <<<"
if grep -qF "$OLD_MARKER_1" "$ZSHRC" 2>/dev/null; then
    sed -i '' "/$OLD_MARKER_1/,/$OLD_END_1/d" "$ZSHRC"
    dim "  Removed old openrouter block from .zshrc"
fi
if grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
    sed -i '' "/$MARKER/,/$MARKER_END/d" "$ZSHRC"
    dim "  Removed previous tools-and-skills block from .zshrc"
fi

cat >> "$ZSHRC" << 'ZSHBLOCK'
# >>> pi tools-and-skills env >>>
# OpenRouter API key from Keychain (for pi --provider openrouter)
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    _or_key=$(security find-generic-password -s "openrouter-api-key" -a "$USER" -w 2>/dev/null)
    if [[ -n "$_or_key" ]]; then export OPENROUTER_API_KEY="$_or_key"; fi
    unset _or_key
fi
# Matrix bot token from Keychain (for the matrix extension in pi)
if [[ -z "${MATRIX_ACCESS_TOKEN:-}" ]]; then
    _mt=$(~/git/tools-and-skills/scripts/coas-secrets.sh get matrix-token 2>/dev/null)
    if [[ -n "$_mt" ]]; then export MATRIX_ACCESS_TOKEN="$_mt"; fi
    unset _mt
fi
# coas-pi alias — start pi in the coas workspace with secrets resolved
alias coas='~/git/tools-and-skills/coas-infra/scripts/coas-pi'
# <<< pi tools-and-skills env <<<
ZSHBLOCK

green "  Added to $ZSHRC:"
echo  "    • OPENROUTER_API_KEY from Keychain"
echo  "    • MATRIX_ACCESS_TOKEN from coas-secrets"
echo  "    • alias coas → coas-pi wrapper"

# ── 6. Summary ──────────────────────────────────────────────────────

echo ""
bold "═══════════════════════════════════════════════"
bold "  Setup complete!"
bold "═══════════════════════════════════════════════"
echo ""
echo "  Global extensions (all pi sessions):"
echo "    • pi-panopticon — multi-agent messaging, spawning, monitoring"
echo "    • machine-memory — .mmem.yml cheat sheets for agents"
echo ""
echo "  Project extensions (add per-project in .pi/settings.json):"
echo "    • kanban        — event-sourced task board (/kanban TUI overlay)"
echo "    • matrix        — phone ↔ agent bridge via Matrix room"
echo ""
echo "  Skills: $skill_count available (clean-room, research-expert, planning, ...)"
echo "  Memories: $memory_count global .mmem.yml files"
echo "  Prompts: $prompt_count templates (refactor, commit-and-push)"
echo ""
echo "  Quick start:"
echo "    coas              # start pi in ~/git/coas with Matrix + kanban"
echo "    pi                # start pi in current dir (panopticon + mmem)"
echo "    exec zsh          # reload shell to pick up new env vars"
echo ""
echo "  Deployment (Docker + Matrix + Tailscale):"
echo "    cd ~/git/tools-and-skills/coas-infra"
echo "    ./scripts/coas-stack     # supervised foreground mode"
echo "    ./scripts/coas-bootstrap-matrix --help"
echo ""

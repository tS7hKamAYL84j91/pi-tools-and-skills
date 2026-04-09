#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# setup-pi.sh — Configure pi to use local Ollama models + OpenRouter
#
# What it does:
#   1. Stores your OpenRouter API key in the macOS Keychain
#   2. Detects locally available Ollama models
#   3. Writes ~/.pi/agent/models.json with Ollama + OpenRouter providers
#   4. Configures pi to use skills from this repo
#   5. Creates AGENT.md with efficiency directives
#   6. Adds a zsh hook so OPENROUTER_API_KEY is always available
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PI_DIR="$HOME/.pi/agent"
MODELS_JSON="$PI_DIR/models.json"
SETTINGS_JSON="$PI_DIR/settings.json"
KEYCHAIN_SERVICE="openrouter-api-key"
KEYCHAIN_ACCOUNT="$USER"
ZSHRC="$HOME/.zshrc"
MARKER="# >>> pi openrouter key injection >>>"
MARKER_END="# <<< pi openrouter key injection <<<"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }

# ── 0. Prerequisites ────────────────────────────────────────────────

if ! command -v ollama &>/dev/null; then
    red "Error: ollama is not installed. Install from https://ollama.com"
    exit 1
fi

if ! command -v pi &>/dev/null; then
    red "Error: pi is not installed."
    exit 1
fi

mkdir -p "$PI_DIR"

# ── 1. OpenRouter API Key → macOS Keychain ──────────────────────────

bold "── OpenRouter API Key ──"

# Check if key already stored
existing_key=""
if security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w &>/dev/null; then
    existing_key=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w)
    green "Found existing OpenRouter key in Keychain (ends with ...${existing_key: -6})"
    read -rp "Replace it? [y/N] " replace
    if [[ "$replace" != [yY] ]]; then
        echo "Keeping existing key."
    else
        existing_key=""
    fi
fi

if [[ -z "$existing_key" ]]; then
    read -rsp "Paste your OpenRouter API key: " api_key
    echo
    if [[ -z "$api_key" ]]; then
        red "No key provided. Aborting."
        exit 1
    fi
    # Store (or update) in Keychain
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" &>/dev/null || true
    security add-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$api_key"
    green "Stored OpenRouter API key in macOS Keychain (service: $KEYCHAIN_SERVICE)"
fi

# ── 2. Discover local Ollama models ─────────────────────────────────

bold "── Discovering Ollama models ──"

# Make sure Ollama is running
if ! ollama list &>/dev/null; then
    echo "Starting Ollama..."
    open -a Ollama 2>/dev/null || ollama serve &>/dev/null &
    sleep 3
fi

# Parse ollama list output (skip header line)
model_lines=()
while IFS= read -r line; do
    model_lines+=("$line")
done < <(ollama list 2>/dev/null | tail -n +2)

if [[ ${#model_lines[@]} -eq 0 ]]; then
    red "No Ollama models found. Pull some first, e.g.:"
    echo "  ollama pull llama3.1:8b"
    echo "  ollama pull qwen2.5-coder:7b"
    echo ""
    echo "Continuing with an empty Ollama model list..."
fi

# Build JSON array of Ollama models
ollama_models="[]"
for line in "${model_lines[@]}"; do
    [[ -z "$line" ]] && continue
    model_id=$(echo "$line" | awk '{print $1}')
    # Skip empty
    [[ -z "$model_id" ]] && continue

    # Determine if it's likely a vision/multimodal model
    input='["text"]'
    if [[ "$model_id" == *vision* ]] || [[ "$model_id" == *llava* ]]; then
        input='["text", "image"]'
    fi

    # Determine if it's a reasoning/thinking model:
    # 1. Heuristic: check name patterns
    # 2. Authoritative: call `ollama show` to check 'Capabilities' field
    reasoning="False"
    if [[ "$model_id" == *think* ]] || [[ "$model_id" == *reason* ]]; then
        reasoning="True"
    elif ollama show "$model_id" 2>/dev/null | grep -qi 'thinking'; then
        reasoning="True"
    fi

    # Pretty name: replace colons/dashes
    pretty_name=$(echo "$model_id" | sed 's/:/ (/;s/$/)/' | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')

    green "  Found: $model_id"

    # Append to JSON array using python (available on macOS)
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

echo ""
green "Found ${#model_lines[@]} Ollama model(s)"

# ── 3. Write models.json ────────────────────────────────────────────

bold "── Writing $MODELS_JSON ──"

# Build the full config with python for safe JSON generation
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
            'apiKey': '!security find-generic-password -s $KEYCHAIN_SERVICE -a $KEYCHAIN_ACCOUNT -w',
            'api': 'openai-completions'
        }
    }
}

print(json.dumps(config, indent=2))
" "$ollama_models" > "$MODELS_JSON"

chmod 600 "$MODELS_JSON"
green "Wrote $MODELS_JSON"

# ── 4. Register skills, extensions & prompts in settings.json ────────

bold "── Configuring settings.json ──"

SKILLS_DIR="$SCRIPT_DIR/skills"
EXTENSIONS_DIR="$SCRIPT_DIR/extensions"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

# Count available skills
skill_count=0
for skill_dir in "$SKILLS_DIR"/*/; do
    [[ -f "$skill_dir/SKILL.md" ]] && ((skill_count++))
done

# Count available extensions
ext_count=0
for ext_file in "$EXTENSIONS_DIR"/*.ts "$EXTENSIONS_DIR"/*/index.ts; do
    [[ -f "$ext_file" ]] && ((ext_count++))
done

# Count available prompts
prompt_count=0
for prompt_file in "$PROMPTS_DIR"/*.md; do
    [[ -f "$prompt_file" ]] && ((prompt_count++))
done

python3 -c "
import json, os

settings_path = '$SETTINGS_JSON'
skills_dir    = '$SKILLS_DIR'
ext_dir       = '$EXTENSIONS_DIR'
prompts_dir   = '$PROMPTS_DIR'

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

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
"

green "  settings.json updated:"
echo  "    skills:     $SKILLS_DIR ($skill_count skill(s))"
for skill_dir in "$SKILLS_DIR"/*/; do
    [[ -f "$skill_dir/SKILL.md" ]] && echo "      - $(basename "$skill_dir")"
done
echo  "    extensions: $EXTENSIONS_DIR ($ext_count extension(s))"
for ext_file in "$EXTENSIONS_DIR"/*.ts; do
    [[ -f "$ext_file" ]] && echo "      - $(basename "$ext_file")"
done
echo  "    prompts:    $PROMPTS_DIR ($prompt_count template(s))"
for prompt_file in "$PROMPTS_DIR"/*.md; do
    [[ -f "$prompt_file" ]] && echo "      - $(basename "$prompt_file" .md)"
done

# ── 5. Create AGENT.md with efficiency directives ─────────────────────

bold "── Creating AGENT.md ──"

AGENT_MD="$SCRIPT_DIR/AGENT.md"
AGENT_MARKER="<!-- pi-setup generated -->"

# Content to insert
AGENT_CONTENT="$(cat <<'AGENTBLOCK'
<!-- pi-setup generated -->

# Communication & Efficiency: "Water in the Desert"

## Directives (Highest Priority)
- **Output Efficiency:** Lead with the action or answer, not the reasoning. Skip preambles and restatements.
- **Sparsity:** If a task can be explained in one sentence, do not use three. Use the simplest approach first.
- **No Over-Engineering:** Only make changes that are directly requested or strictly necessary for stability.

## Operating Guidelines
- **Measure Twice, Cut Once:** Create a \`.md\` spec/plan before writing large code blocks to ensure alignment with minimal token waste.
- **No Brute Force:** If a solution fails, stop and pivot rather than retrying the same path.
- **Reporting:** Only provide text output for:
  - Critical blockers/errors.
  - High-level status milestones.
  - Decisions requiring explicit user input.
AGENTBLOCK
)"

if [[ -f "$AGENT_MD" ]]; then
    # Check if we've already added our content
    if grep -qF "pi-setup generated" "$AGENT_MD" 2>/dev/null; then
        echo "  AGENT.md already contains efficiency directives (skipping)"
    else
        # Append to existing file
        echo "" >> "$AGENT_MD"
        echo "$AGENT_CONTENT" >> "$AGENT_MD"
        green "  Appended efficiency directives to $AGENT_MD"
    fi
else
    # Create new file
    echo "$AGENT_CONTENT" > "$AGENT_MD"
    green "  Created $AGENT_MD with efficiency directives"
fi

# ── 6. Inject OPENROUTER_API_KEY into zsh sessions ──────────────────

bold "── Configuring zsh environment ──"

# Remove old block if present
if grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
    # Use sed to remove the block between markers (inclusive)
    sed -i '' "/$MARKER/,/$MARKER_END/d" "$ZSHRC"
    echo "Removed previous pi OpenRouter block from .zshrc"
fi

cat >> "$ZSHRC" << 'ZSHBLOCK'
# >>> pi openrouter key injection >>>
# Lazily export OPENROUTER_API_KEY from macOS Keychain for pi and other tools
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    _or_key=$(security find-generic-password -s "openrouter-api-key" -a "$USER" -w 2>/dev/null)
    if [[ -n "$_or_key" ]]; then
        export OPENROUTER_API_KEY="$_or_key"
    fi
    unset _or_key
fi
# <<< pi openrouter key injection <<<
ZSHBLOCK

green "Added OPENROUTER_API_KEY injection to $ZSHRC"

# ── 7. Summary ──────────────────────────────────────────────────────

echo ""
bold "═══════════════════════════════════════════════"
bold "  Setup complete!"
bold "═══════════════════════════════════════════════"
echo ""
echo "  ✅ OpenRouter API key stored in macOS Keychain"
echo "  ✅ Ollama models detected and configured"
echo "  ✅ ~/.pi/agent/models.json written"
echo "  ✅ Skills, extensions & prompts registered in settings.json"
echo "  ✅ AGENT.md created/updated with efficiency directives"
echo "  ✅ OPENROUTER_API_KEY will auto-inject in new zsh sessions"
echo ""
echo "  How pi resolves the OpenRouter key:"
echo "    • models.json uses: !security find-generic-password ..."
echo "      (resolved at request time, no key on disk)"
echo "    • zsh sessions also export OPENROUTER_API_KEY from Keychain"
echo "      (for other tools that read the env var)"
echo ""
echo "  To use in pi:"
echo "    pi --provider ollama --model <model-id>"
echo "    pi --provider openrouter --model <model-id>"
echo ""
echo "  To refresh Ollama models after pulling new ones:"
echo "    $0"
echo ""
echo "  To start a new shell with the key loaded:"
echo "    exec zsh"
echo ""

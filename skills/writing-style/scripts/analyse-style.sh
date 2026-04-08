#!/usr/bin/env bash
# analyse-style.sh — Ingest a writing corpus and extract stylometric signals
#
# Usage:
#   analyse-style.sh <corpus_dir> [--samples N] [--min-words N]
#
# Output: Structured digest (stdout) ready for the LLM to generate a style profile.
# Pipe to a file or paste directly into the Generate Style Profile prompt.
#
# Requirements: bash, awk, sed, grep, find, wc (all standard Unix tools)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
CORPUS_DIR=""
NUM_SAMPLES=10
MIN_WORDS=100       # skip files shorter than this
SAMPLE_WORDS=150    # approximate words per sample passage

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples) NUM_SAMPLES="$2"; shift 2 ;;
    --min-words) MIN_WORDS="$2"; shift 2 ;;
    --sample-words) SAMPLE_WORDS="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) CORPUS_DIR="$1"; shift ;;
  esac
done

if [[ -z "$CORPUS_DIR" ]]; then
  echo "Usage: analyse-style.sh <corpus_dir> [--samples N] [--min-words N]" >&2
  exit 1
fi

if [[ ! -d "$CORPUS_DIR" ]]; then
  echo "Error: '$CORPUS_DIR' is not a directory." >&2
  exit 1
fi

# ── Collect corpus files ───────────────────────────────────────────────────────
mapfile -t FILES < <(find "$CORPUS_DIR" -type f \( -name "*.txt" -o -name "*.md" \) | sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Error: No .txt or .md files found in '$CORPUS_DIR'." >&2
  exit 1
fi

# Filter by min word count
VALID_FILES=()
for f in "${FILES[@]}"; do
  wc=$(wc -w < "$f")
  if [[ "$wc" -ge "$MIN_WORDS" ]]; then
    VALID_FILES+=("$f")
  fi
done

if [[ ${#VALID_FILES[@]} -eq 0 ]]; then
  echo "Error: No files with ≥${MIN_WORDS} words found." >&2
  exit 1
fi

# ── Concatenate full corpus to a temp file ─────────────────────────────────────
TMPFILE=$(mktemp /tmp/corpus_XXXXXX.txt)
trap 'rm -f "$TMPFILE"' EXIT

for f in "${VALID_FILES[@]}"; do
  # Strip YAML frontmatter (--- ... ---) from Markdown files
  sed '/^---$/,/^---$/d' "$f" >> "$TMPFILE"
  echo "" >> "$TMPFILE"
done

# ── Corpus-level stats ────────────────────────────────────────────────────────
TOTAL_WORDS=$(wc -w < "$TMPFILE")
TOTAL_CHARS=$(wc -c < "$TMPFILE")
TOTAL_LINES=$(wc -l < "$TMPFILE")

# Sentence count: count sentence-ending punctuation (. ! ?)
TOTAL_SENTENCES=$(grep -oE '[.!?]+' "$TMPFILE" | wc -l || echo 0)
[[ "$TOTAL_SENTENCES" -eq 0 ]] && TOTAL_SENTENCES=1

AVG_SENT_WORDS=$(echo "scale=1; $TOTAL_WORDS / $TOTAL_SENTENCES" | bc 2>/dev/null || echo "n/a")

# Paragraph count (blank-line separated blocks)
PARA_COUNT=$(grep -c '^$' "$TMPFILE" || echo 1)
[[ "$PARA_COUNT" -eq 0 ]] && PARA_COUNT=1
AVG_PARA_WORDS=$(echo "scale=1; $TOTAL_WORDS / $PARA_COUNT" | bc 2>/dev/null || echo "n/a")

# ── Punctuation density (per 1000 words) ──────────────────────────────────────
count_pattern() { grep -oE "$1" "$TMPFILE" | wc -l || echo 0; }
scale_per1k() {
  local n=$1
  echo "scale=1; ($n * 1000) / $TOTAL_WORDS" | bc 2>/dev/null || echo "n/a"
}

EM_DASH=$(count_pattern '—|--|–')
SEMICOLON=$(count_pattern ';')
COLON=$(count_pattern ':')
ELLIPSIS=$(count_pattern '\.\.\.|…')
EXCLAMATION=$(count_pattern '!')
QUESTION=$(count_pattern '\?')
COMMA=$(count_pattern ',')
PARENTHESIS=$(count_pattern '\(')

EM_DASH_R=$(scale_per1k "$EM_DASH")
SEMICOLON_R=$(scale_per1k "$SEMICOLON")
COLON_R=$(scale_per1k "$COLON")
ELLIPSIS_R=$(scale_per1k "$ELLIPSIS")
EXCLAMATION_R=$(scale_per1k "$EXCLAMATION")
QUESTION_R=$(scale_per1k "$QUESTION")
COMMA_R=$(scale_per1k "$COMMA")
PAREN_R=$(scale_per1k "$PARENTHESIS")

# ── Voice markers ─────────────────────────────────────────────────────────────
FIRST_PERSON=$(grep -ioE '\bI\b|\bI'\''m\b|\bI'\''ve\b|\bI'\''d\b|\bI'\''ll\b|\bme\b|\bmy\b|\bmine\b|\bmyself\b' "$TMPFILE" | wc -l || echo 0)
FIRST_PERSON_R=$(scale_per1k "$FIRST_PERSON")

PASSIVE=$(grep -ioE '\b(is|are|was|were|be|been|being) [a-z]+ed\b' "$TMPFILE" | wc -l || echo 0)
PASSIVE_R=$(scale_per1k "$PASSIVE")

HEDGES=$(grep -ioE '\b(maybe|perhaps|probably|might|seems|appears|somewhat|rather|fairly|quite|often|usually|generally|tends to|can be|could be)\b' "$TMPFILE" | wc -l || echo 0)
HEDGES_R=$(scale_per1k "$HEDGES")

# ── Common transition words ────────────────────────────────────────────────────
TRANSITIONS=$(grep -ioE '\b(however|therefore|moreover|furthermore|nevertheless|nonetheless|consequently|meanwhile|instead|otherwise|indeed|notably|crucially|importantly|ultimately|essentially|specifically|particularly|that is|in other words|for example|for instance|in fact|in practice|in theory|of course|after all|at the same time|on the other hand|by contrast|as a result)\b' "$TMPFILE" | wc -l || echo 0)
TRANSITIONS_R=$(scale_per1k "$TRANSITIONS")

# ── Vocabulary richness (type-token ratio on first 2000 words) ────────────────
TTR=$(awk '{ for(i=1;i<=NF;i++) { word=tolower($i); gsub(/[^a-z]/,"",word); if(word!="") { tokens++; words[word]++ } } } END { if(tokens>0) printf "%.3f", length(words)/tokens; else print "n/a" }' <(head -c 12000 "$TMPFILE"))

# ── Top function words ────────────────────────────────────────────────────────
TOP_WORDS=$(tr '[:upper:]' '[:lower:]' < "$TMPFILE" \
  | grep -oE '\b[a-z]+\b' \
  | grep -E '^\b(the|a|an|and|but|or|so|yet|for|nor|if|although|because|since|while|when|that|which|this|these|those|it|its|they|their|there|here|not|just|also|even|only|still|already|always|never|very|really|quite|more|most|much|many|few|some|any|all|both|each|every|no|other|same|such|well|now|then|how|what|why|who|where|will|would|could|should|may|might|must|shall|have|has|had|do|does|did|be|is|are|was|were|been|being|get|got|make|made|take|took|know|think|see|look|come|go|say|said|tell|told|use|find|give|work|seem|feel|become|keep|let|put|show|try|ask|need|mean|turn|start|end|first|last|new|old|good|great|small|large|long|short|high|low|right|left|own|next|back|down|up|off|out|over|under|again|before|after|between|through|around|about|against|without|within|during|along|across|behind|above|below|near|far)\b' \
  | sort | uniq -c | sort -rn | head -20 \
  | awk '{printf "%s(%d) ", $2, $1}')

# ── Sample passages ───────────────────────────────────────────────────────────
# Select N evenly-spaced excerpts from the corpus
CORPUS_WORDS_FOR_SAMPLE=$(wc -w < "$TMPFILE")
STRIDE=$(( CORPUS_WORDS_FOR_SAMPLE / (NUM_SAMPLES + 1) ))
[[ "$STRIDE" -lt 1 ]] && STRIDE=1

extract_passage() {
  local start_word=$1
  local word_count=$2
  # Use awk to extract approximately word_count words starting at start_word
  awk -v start="$start_word" -v count="$word_count" '
  BEGIN { w=0; printing=0; out="" }
  {
    n = split($0, tokens, " ")
    for (i=1; i<=n; i++) {
      w++
      if (w >= start && w < start+count) {
        out = out tokens[i] " "
      }
    }
    if (w >= start && w < start+count) out = out "\n"
  }
  END { print out }
  ' "$TMPFILE"
}

# ── Output ────────────────────────────────────────────────────────────────────
echo "# Writing Corpus Analysis"
echo "Generated: $(date '+%Y-%m-%d %H:%M')"
echo ""
echo "## Corpus Overview"
echo ""
echo "| Metric | Value |"
echo "|--------|-------|"
echo "| Files analysed | ${#VALID_FILES[@]} |"
echo "| Total words | $TOTAL_WORDS |"
echo "| Total sentences (est.) | $TOTAL_SENTENCES |"
echo "| Avg sentence length | $AVG_SENT_WORDS words |"
echo "| Avg paragraph length | $AVG_PARA_WORDS words |"
echo "| Vocabulary richness (TTR) | $TTR |"
echo ""
echo "## Punctuation Density (per 1,000 words)"
echo ""
echo "| Mark | Count | Per 1k |"
echo "|------|-------|--------|"
echo "| Em-dash / en-dash | $EM_DASH | $EM_DASH_R |"
echo "| Semicolon | $SEMICOLON | $SEMICOLON_R |"
echo "| Colon | $COLON | $COLON_R |"
echo "| Ellipsis | $ELLIPSIS | $ELLIPSIS_R |"
echo "| Exclamation | $EXCLAMATION | $EXCLAMATION_R |"
echo "| Question mark | $QUESTION | $QUESTION_R |"
echo "| Comma | $COMMA | $COMMA_R |"
echo "| Parenthesis | $PARENTHESIS | $PAREN_R |"
echo ""
echo "## Voice Markers (per 1,000 words)"
echo ""
echo "| Marker | Count | Per 1k |"
echo "|--------|-------|--------|"
echo "| First-person pronouns | $FIRST_PERSON | $FIRST_PERSON_R |"
echo "| Passive constructions | $PASSIVE | $PASSIVE_R |"
echo "| Hedging language | $HEDGES | $HEDGES_R |"
echo "| Transition words | $TRANSITIONS | $TRANSITIONS_R |"
echo ""
echo "## High-Frequency Function Words"
echo ""
echo "$TOP_WORDS" | tr ' ' '\n' | grep -v '^$' | head -20 | paste - - - - - 2>/dev/null || echo "$TOP_WORDS"
echo ""
echo "## Source Files"
echo ""
for f in "${VALID_FILES[@]}"; do
  wc=$(wc -w < "$f")
  echo "- \`$(basename "$f")\` ($wc words)"
done
echo ""
echo "---"
echo ""
echo "## Sample Passages (${NUM_SAMPLES} excerpts, ~${SAMPLE_WORDS} words each)"
echo ""
echo "*These passages are drawn from across the corpus for the LLM to analyse.*"
echo ""

for i in $(seq 1 "$NUM_SAMPLES"); do
  start=$(( i * STRIDE ))
  echo "### Sample $i (approx. word $start)"
  echo ""
  extract_passage "$start" "$SAMPLE_WORDS"
  echo ""
  echo "---"
  echo ""
done

echo "## Instructions for LLM"
echo ""
echo "Using the corpus statistics and sample passages above, generate a structured"
echo "style profile. Save the result to \`skills/writing-style/assets/style-profile.md\`."
echo "Use the **Generate Style Profile** prompt from \`skills/writing-style/SKILL.md\`."

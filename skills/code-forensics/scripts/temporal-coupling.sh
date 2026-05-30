#!/usr/bin/env bash
# temporal-coupling.sh — find files that change together (hidden dependencies)
#
# Coupling % = (shared commits) / (min commits of either file) × 100
#   ≥ 80%  → effectively one module — consider merging
#   30–79% → hidden dependency — document or refactor
#   < 30%  → coincidental — no action needed
#
# Usage: temporal-coupling.sh [--since "6 months ago"] [--min-coupling 30] [--top 20] [--max-commits 500]

set -euo pipefail

SINCE="6 months ago"
MIN_COUPLING=30
TOP=20
MAX_COMMITS=500

while [[ $# -gt 0 ]]; do
    case $1 in
        --since)        SINCE="$2";        shift 2 ;;
        --min-coupling) MIN_COUPLING="$2"; shift 2 ;;
        --top)          TOP="$2";          shift 2 ;;
        --max-commits)  MAX_COMMITS="$2";  shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--since '6 months ago'] [--min-coupling 30] [--top 20] [--max-commits 500]"
            exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "=== Temporal Coupling Analysis ==="
echo "Since:        $SINCE"
echo "Min coupling: ${MIN_COUPLING}%"
echo "Max commits:  $MAX_COMMITS"
echo ""

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# Use the full commit hash (%H) as a natural per-commit delimiter.
# Detect hash lines in awk: 40 hex chars, length == 40.
git log --since="$SINCE" --format="%H" --name-only \
  | awk -v max_commits="$MAX_COMMITS" '
BEGIN { nfiles = 0; commit_num = 0 }

# Full SHA-1 hash line → start of a new commit
length($0) == 40 && $0 ~ /^[0-9a-f]+$/ {
    # Flush files collected for the previous commit
    if (nfiles > 0) {
        for (i = 1; i <= nfiles; i++) {
            fc[files[i]]++
            for (j = i+1; j <= nfiles; j++) {
                a = files[i]; b = files[j]
                if (a > b) { t = a; a = b; b = t }
                pc[a SUBSEP b]++
            }
        }
        delete files; nfiles = 0
    }
    commit_num++
    if (commit_num > max_commits) exit
    next
}

/^$/ { next }
{ files[++nfiles] = $0 }

END {
    # Flush the final commit (or partial batch after exit)
    for (i = 1; i <= nfiles; i++) {
        fc[files[i]]++
        for (j = i+1; j <= nfiles; j++) {
            a = files[i]; b = files[j]
            if (a > b) { t = a; a = b; b = t }
            pc[a SUBSEP b]++
        }
    }
    for (key in pc) {
        split(key, p, SUBSEP)
        shared = pc[key]
        da = fc[p[1]]; db = fc[p[2]]
        denom = (da < db) ? da : db
        if (denom > 0) {
            pct = int(shared * 100 / denom)
            print pct "\t" shared "\t" denom "\t" p[1] "\t" p[2]
        }
    }
}' > "$tmpfile"

if [ ! -s "$tmpfile" ]; then
    echo "(no co-changing file pairs found in range)"
    exit 0
fi

printf "%-7s  %-12s  %-45s  %s\n" "COUPL%" "SHARED/TOTAL" "FILE-A" "FILE-B"
printf "%-7s  %-12s  %-45s  %s\n" "-------" "------------" "---------------------------------------------" "------"

sort -t$'\t' -k1 -rn "$tmpfile" \
  | awk -v min="$MIN_COUPLING" -v top="$TOP" -F'\t' '
BEGIN { found = 0 }
$1 >= min && found < top {
    label = ($1 >= 80) ? "  <- merge?" : ($1 >= 30) ? "  <- document" : ""
    printf "%-7s  %-12s  %-45s  %s%s\n", $1 "%", $2 "/" $3, $4, $5, label
    found++
}
END { if (found == 0) print "(no pairs above " min "% threshold)" }
'

#!/usr/bin/env bash
# churn.sh — lines added and removed per file from git history
#
# High total churn (adds + removes) = instability indicator.
# High removals relative to additions = refactoring in progress.
# Pair with hotspots.sh: files that are large AND high-churn are riskiest.
#
# Usage: churn.sh [--since "6 months ago"] [--top 20]

set -euo pipefail

SINCE="6 months ago"
TOP=20

while [[ $# -gt 0 ]]; do
    case $1 in
        --since) SINCE="$2"; shift 2 ;;
        --top)   TOP="$2";   shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--since '6 months ago'] [--top 20]"
            exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "=== Code Churn Analysis ==="
echo "Since: $SINCE"
echo "Top:   $TOP files by total churn (additions + deletions)"
echo ""
printf "%-10s  %-10s  %-10s  %s\n" "ADDED" "REMOVED" "NET" "FILE"
printf "%-10s  %-10s  %-10s  %s\n" "----------" "----------" "----------" "----"

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# --numstat lines: <added>\t<removed>\t<file>  (binary files show - - <file>)
# --format=format: suppresses commit header lines entirely.
git log --since="$SINCE" --numstat --format=format: \
  | awk -F'\t' '
NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {
    file = $3

    # Normalise rename notation to the destination path:
    #   "src/{old => new}/file"  →  "src/new/file"
    #   "old/path => new/path"   →  "new/path"
    if (file ~ /\{[^}]* => [^}]*\}/) {
        prefix = file; suffix = file
        gsub(/\{.*/, "", prefix)
        gsub(/.*\}/, "", suffix)
        middle = file; gsub(/.*\{/, "", middle); gsub(/\}.*/, "", middle)
        split(middle, m, " => ")
        file = prefix m[2] suffix
    } else if (file ~ / => /) {
        split(file, m, " => ")
        file = m[2]
    }

    adds[file]  += $1
    dels[file]  += $2
    total[file] += $1 + $2
}
END {
    for (f in total) {
        net  = adds[f] - dels[f]
        sign = (net >= 0) ? "+" : ""
        print total[f] "\t" adds[f] "\t" dels[f] "\t" sign net "\t" f
    }
}' > "$tmpfile"

if [ ! -s "$tmpfile" ]; then
    echo "(no churn data found in range)"
    exit 0
fi

sort -t$'\t' -k1 -rn "$tmpfile" \
  | head -"$TOP" \
  | awk -F'\t' '{
    printf "%-10s  %-10s  %-10s  %s\n", "+" $2, "-" $3, $4, $5
}'

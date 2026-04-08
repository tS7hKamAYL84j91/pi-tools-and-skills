#!/usr/bin/env bash
# hotspots.sh — identify high-churn, high-complexity files
#
# Hotspot score = change_count × √(line_count)
# Files with high churn AND high complexity are your biggest risk.
#
# Usage: hotspots.sh [--since "6 months ago"] [--top 20] [--path src/]

set -euo pipefail

SINCE="6 months ago"
TOP=20
PATH_FILTER=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --since)  SINCE="$2";       shift 2 ;;
        --top)    TOP="$2";         shift 2 ;;
        --path)   PATH_FILTER="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--since '6 months ago'] [--top 20] [--path src/]"
            exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "=== Hotspot Analysis ==="
echo "Since:  $SINCE"
echo "Top:    $TOP files"
[ -n "$PATH_FILTER" ] && echo "Path:   $PATH_FILTER"
echo ""
printf "%-8s  %-8s  %-10s  %s\n" "CHANGES" "LINES" "SCORE" "FILE"
printf "%-8s  %-8s  %-10s  %s\n" "-------" "-----" "----------" "----"

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# Step 1: get change counts per file
git log --since="$SINCE" --format=format: --name-only ${PATH_FILTER:+-- "$PATH_FILTER"} \
    | grep -v '^$' \
    | sort \
    | uniq -c \
    | sort -rn \
    | head -"$TOP" \
    | while read -r count file; do
        if [ -f "$file" ]; then
            lines=$(wc -l < "$file" | tr -d ' ')
        else
            lines=0
        fi
        score=$(awk "BEGIN { printf \"%d\", $count * sqrt($lines + 1) }")
        # Prefix with zero-padded score for stable sort, then the fields
        printf "%010d|%s|%s|%s\n" "$score" "$count" "$lines" "$file"
    done > "$tmpfile"

# Step 2: sort by score desc, format output
sort -rn "$tmpfile" | awk -F'|' '{
    score = $1 + 0   # strip leading zeros
    printf "%-8s  %-8s  %-10s  %s\n", $2, $3, score, $4
}'

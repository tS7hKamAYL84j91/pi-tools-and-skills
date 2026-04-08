#!/usr/bin/env bash
# age-map.sh — days since each tracked file was last modified in git history
#
# Age guide:
#   < 30 days   → actively developed
#   30–180 days → normal maintenance cycle
#   180–365 days→ potentially stable or neglected
#   > 365 days  → stale (bug trap?) or very stable (good?)
#
# Usage: age-map.sh [--top 30]

set -euo pipefail

TOP=30

while [[ $# -gt 0 ]]; do
    case $1 in
        --top) TOP="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--top 30]"
            exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "=== Age Map — Stale File Detector ==="
echo "Top: $TOP oldest files"
echo ""
printf "%-12s  %-7s  %s\n" "LAST-MODIFIED" "AGE" "FILE"
printf "%-12s  %-7s  %s\n" "------------" "-------" "----"

NOW=$(date +%s)

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# git log --format="%at" --name-only outputs:
#   <unix-timestamp>
#   (blank)
#   file1
#   file2
#   (blank)
#   <unix-timestamp>
#   ...
# git log is newest-first, so the first time we see a file = its most recent commit.
git log --format="%at" --name-only \
  | awk -v now="$NOW" '
/^[0-9]+$/ { cur_ts = $0; next }
/^$/        { next }
{
    file = $0
    if (!(file in seen)) {
        seen[file] = cur_ts
    }
}
END {
    for (file in seen) {
        ts   = seen[file]
        days = int((now - ts) / 86400)
        print days "\t" ts "\t" file
    }
}' > "$tmpfile"

if [ ! -s "$tmpfile" ]; then
    echo "(no tracked files found)"
    exit 0
fi

# Detect GNU date (Linux) vs BSD date (macOS) once before the loop
if date -d "@0" "+%Y" >/dev/null 2>&1; then
    DATE_FMT="gnu"
else
    DATE_FMT="bsd"
fi

sort -t$'\t' -k1 -rn "$tmpfile" | head -"$TOP" | while IFS=$'\t' read -r days ts file; do
    if [ "$DATE_FMT" = "gnu" ]; then
        last_date=$(date -d "@$ts" "+%Y-%m-%d")
    else
        last_date=$(date -r "$ts" "+%Y-%m-%d")
    fi

    if   [ "$days" -gt 365 ]; then label="  <- stale?"
    elif [ "$days" -gt 180 ]; then label="  <- monitor"
    else label=""
    fi

    printf "%-12s  %-7s  %s%s\n" "$last_date" "${days}d" "$file" "$label"
done

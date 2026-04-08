#!/usr/bin/env bash
# knowledge-map.sh — who owns each file (primary author by commit count)
#
# Files where one author holds > 80% of commits = bus-factor risk.
# Sorted by total commit count so high-churn files with narrow ownership surface first.
#
# Usage: knowledge-map.sh [--since "12 months ago"] [--top 30] [--min-commits 2]

set -euo pipefail

SINCE="12 months ago"
TOP=30
MIN_COMMITS=2

while [[ $# -gt 0 ]]; do
    case $1 in
        --since)       SINCE="$2";       shift 2 ;;
        --top)         TOP="$2";         shift 2 ;;
        --min-commits) MIN_COMMITS="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--since '12 months ago'] [--top 30] [--min-commits 2]"
            exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "=== Knowledge Map / Ownership Analysis ==="
echo "Since:       $SINCE"
echo "Top:         $TOP files (by commit count)"
echo "Min commits: $MIN_COMMITS"
echo ""
printf "%-8s  %-6s  %-28s  %s\n" "COMMITS" "OWN%" "PRIMARY-AUTHOR" "FILE"
printf "%-8s  %-6s  %-28s  %s\n" "-------" "------" "----------------------------" "----"

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# Interleave AUTHOR: markers with file lists so awk can associate them.
# --format="AUTHOR:%aN" outputs one author line per commit;
# --name-only appends the changed files after it.
git log --since="$SINCE" --format="AUTHOR:%aN" --name-only \
  | awk '
/^AUTHOR:/ { cur_author = substr($0, 8); next }
/^$/       { next }
{
    file = $0
    file_total[file]++
    ac[file SUBSEP cur_author]++
}
END {
    # Find primary author (highest commit count) per file
    for (key in ac) {
        split(key, p, SUBSEP)
        file   = p[1]
        author = p[2]
        count  = ac[key]
        if (count > best_count[file]) {
            best_count[file]  = count
            best_author[file] = author
        }
    }
    for (file in best_count) {
        total  = file_total[file]
        count  = best_count[file]
        author = best_author[file]
        pct    = int(count * 100 / total)
        print total "\t" pct "\t" author "\t" file
    }
}' > "$tmpfile"

if [ ! -s "$tmpfile" ]; then
    echo "(no file history found in range)"
    exit 0
fi

sort -t$'\t' -k1 -rn "$tmpfile" \
  | head -"$TOP" \
  | awk -F'\t' -v min_commits="$MIN_COMMITS" '
$1 >= min_commits {
    risk = ($2 >= 80) ? "  [BUS-FACTOR]" : ""
    printf "%-8s  %-6s  %-28s  %s%s\n", $1, $2 "%", $3, $4, risk
}'

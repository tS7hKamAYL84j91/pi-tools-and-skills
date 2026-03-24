#!/bin/bash
# Check completion status of tasks in planning/PLAN.md
# Usage: ./check-complete.sh

PLAN_FILE="planning/PLAN.md"

if [ ! -f "$PLAN_FILE" ]; then
    echo "[planning] No planning/PLAN.md found — no active planning session."
    exit 0
fi

# Count total tasks (lines starting with - [ ])
TOTAL_TASKS=$(grep -c "\- \[ \]" "$PLAN_FILE" || true)
COMPLETED_TASKS=$(grep -c "\- \[x\]" "$PLAN_FILE" || true)
TOTAL_ITEMS=$((TOTAL_TASKS + COMPLETED_TASKS))

if [ "$TOTAL_ITEMS" -eq 0 ]; then
    echo "[planning] No tasks found in $PLAN_FILE."
    exit 0
fi

PERCENTAGE=$((COMPLETED_TASKS * 100 / TOTAL_ITEMS))

echo "[planning] Completion Status:"
echo "Tasks: $COMPLETED_TASKS / $TOTAL_ITEMS ($PERCENTAGE%)"

if [ "$COMPLETED_TASKS" -eq "$TOTAL_ITEMS" ]; then
    echo "ALL TASKS COMPLETE"
else
    echo "Tasks remaining: $TOTAL_TASKS"
fi

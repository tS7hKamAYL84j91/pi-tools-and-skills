#!/bin/bash
# Initialize planning files for a new session
# Usage: ./init-session.sh

set -e

# Get the absolute path to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# Determine the assets directory relative to the script
ASSETS_DIR="$SCRIPT_DIR/../assets"

# Check if assets directory exists
if [ ! -d "$ASSETS_DIR" ]; then
    echo "Error: Assets directory not found at $ASSETS_DIR"
    exit 1
fi

# Create planning directory
mkdir -p planning

echo "Initializing planning files in planning/"

# Create PLAN.md
if [ ! -f "planning/PLAN.md" ]; then
    cp "$ASSETS_DIR/PLAN_TEMPLATE.md" planning/PLAN.md
    echo "Created planning/PLAN.md"
else
    echo "planning/PLAN.md already exists, skipping"
fi

# Create PROGRESS.md
if [ ! -f "planning/PROGRESS.md" ]; then
    # We can perform variable substitution if needed, but for now we copy the template
    # Note: If the template has variables like $(date), they won't be expanded by cp.
    # To expand variables, we could use envsubst or similar.
    # For now, let's just copy the template.
    cp "$ASSETS_DIR/PROGRESS_TEMPLATE.md" planning/PROGRESS.md
    echo "Created planning/PROGRESS.md"
else
    echo "planning/PROGRESS.md already exists, skipping"
fi

# Create KNOWLEDGE.md
if [ ! -f "planning/KNOWLEDGE.md" ]; then
    cp "$ASSETS_DIR/KNOWLEDGE_TEMPLATE.md" planning/KNOWLEDGE.md
    echo "Created planning/KNOWLEDGE.md"
else
    echo "planning/KNOWLEDGE.md already exists, skipping"
fi

echo ""
echo "Planning files initialized!"

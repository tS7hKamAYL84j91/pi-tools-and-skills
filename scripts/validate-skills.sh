#!/bin/bash

# Script to validate all skills against the Agent Skills specification

echo "Validating all skills for specification compliance..."
echo "=============================================="
echo ""

FAILED=0
WARNINGS=0

# Function to extract YAML frontmatter cleanly
extract_frontmatter() {
    local file="$1"
    awk '/^---$/ {if (++count==1) {next}; if (count==2) {exit}}; count==1' "$file"
}

# Function to get field value from frontmatter (handles quoted and unquoted values)
get_field() {
    local frontmatter="$1"
    local field="$2"
    echo "$frontmatter" | grep "^${field}:" | head -1 | sed "s/^${field}[: ]*//;s/^['\"]//;s/['\"]$//" | tr -d '\n'
}

for skill_dir in /Users/jim/git/tools-and-skills/skills/*/; do
    if [ ! -d "$skill_dir" ]; then
        continue
    fi
    
    skill_name=$(basename "$skill_dir")
    skill_file="$skill_dir/SKILL.md"
    
    echo "Checking skill: $skill_name"
    
    # Check if SKILL.md exists
    if [ ! -f "$skill_file" ]; then
        echo "  ✗ Missing SKILL.md file"
        FAILED=$((FAILED + 1))
        continue
    fi
    
    # Extract frontmatter (only between first two ---)
    frontmatter=$(extract_frontmatter "$skill_file")
    
    if [ -z "$frontmatter" ]; then
        echo "  ✗ No frontmatter found (expected YAML between --- delimiters)"
        FAILED=$((FAILED + 1))
        continue
    fi
    
    # Check name field
    name_field=$(get_field "$frontmatter" "name")
    if [ -z "$name_field" ]; then
        echo "  ✗ Missing name field"
        FAILED=$((FAILED + 1))
    elif [ "$name_field" != "$skill_name" ]; then
        echo "  ✗ Name field '$name_field' doesn't match directory '$skill_name'"
        FAILED=$((FAILED + 1))
    else
        echo "  ✓ Name field matches directory"
    fi
    
    # Check name format (lowercase, hyphens only)
    if [ -n "$name_field" ] && [[ ! "$name_field" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
        echo "  ✗ Name contains invalid characters (must be lowercase a-z, 0-9, hyphens)"
        FAILED=$((FAILED + 1))
    fi
    
    # Check description field exists and is non-empty
    desc_field=$(get_field "$frontmatter" "description")
    if [ -z "$desc_field" ]; then
        echo "  ✗ Missing description field"
        FAILED=$((FAILED + 1))
    else
        # Count actual description characters
        desc_length=$(echo -n "$desc_field" | wc -c)
        if [ "$desc_length" -gt 1024 ]; then
            echo "  ⚠ Description exceeds 1024 characters ($desc_length chars)"
            WARNINGS=$((WARNINGS + 1))
        else
            echo "  ✓ Description field present ($desc_length chars)"
        fi
    fi
    
    # Check for non-standard fields by looking at YAML keys only (skip multiline values)
    # Get all lines that look like YAML keys (not indented, have a colon)
    yaml_keys=$(echo "$frontmatter" | grep -v "^[[:space:]]" | grep ":" | cut -d: -f1)
    
    # Check if any keys are non-standard (not in the spec)
    non_standard=""
    while IFS= read -r key; do
        [ -z "$key" ] && continue
        case "$key" in
            name|description|license|compatibility|metadata|allowed-tools)
                # These are standard
                ;;
            triggers)
                # Commonly added but not in spec
                non_standard="$non_standard$key "
                ;;
            *)
                # Check if it looks like a real YAML key (only letters, numbers, hyphens, underscores)
                if [[ "$key" =~ ^[a-z_-]+$ ]]; then
                    non_standard="$non_standard$key "
                fi
                ;;
        esac
    done <<< "$yaml_keys"
    
    if [ -n "$non_standard" ]; then
        echo "  ⚠ Non-standard fields found (should be in metadata):"
        for field in $non_standard; do
            echo "      - $field"
        done
        WARNINGS=$((WARNINGS + 1))
    fi
    
    # Check file length
    lines=$(wc -l < "$skill_file")
    if [ "$lines" -gt 500 ]; then
        echo "  ⚠ SKILL.md exceeds 500 lines ($lines lines)"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "  ✓ SKILL.md length okay ($lines lines)"
    fi
    
    # Check for subdirectories
    subdirs=""
    [ -d "$skill_dir/scripts" ] && subdirs="scripts "
    [ -d "$skill_dir/references" ] && subdirs="${subdirs}references "
    [ -d "$skill_dir/assets" ] && subdirs="${subdirs}assets"
    if [ -n "$subdirs" ]; then
        echo "  📁 Has subdirectories: $subdirs"
    fi
    
    echo ""
done

echo "=============================================="
echo "Validation Results:"
echo ""
if [ "$FAILED" -eq 0 ]; then
    echo "✓ All skills passed validation!"
    if [ "$WARNINGS" -eq 0 ]; then
        echo "  (No warnings)"
    else
        echo "  ⚠ $WARNINGS warning(s) found - see above"
    fi
else
    echo "✗ $FAILED skill(s) have validation errors"
    if [ "$WARNINGS" -gt 0 ]; then
        echo "  ⚠ $WARNINGS additional warning(s)"
    fi
fi

exit $FAILED

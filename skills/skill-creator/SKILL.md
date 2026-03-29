---
name: skill-creator
description: Create new skills or improve existing ones. Use when users want to create a skill, modify a skill, or optimize skill descriptions. Includes the full Agent Skills specification.
---

# Skill Creator

Create and refine skills following the Agent Skills specification.

## Skill Structure

```
skill-name/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional: executable helper scripts
├── references/           # Optional: detailed documentation
└── assets/               # Optional: static resources
```

## Creating a New Skill

### 1. Capture Intent

Understand what the user wants:
- What should this skill enable?
- When should it trigger? (specific phrases/contexts)
- What's the expected output?
- Are there test cases to verify?

### 2. Create Directory

```
skill-name/
└── SKILL.md
```

The directory name must match the `name` field in frontmatter.

### 3. Write Frontmatter

Required fields:

```yaml
---
name: skill-name                    # Must match directory name
description: What it does AND when to use it. Include trigger contexts.
---
```

Optional fields: `license`, `compatibility`, `metadata`, `allowed-tools`

### 4. Write Instructions

Keep the body under 500 lines. Move detailed docs to `references/`.

```markdown
# My Skill

## Setup
One-time setup instructions.

## Usage
How to use with examples.

## Examples
**Input:** request
**Output:** expected result
```

### 5. Add Supporting Files

- `scripts/` — executable helpers
- `references/` — detailed documentation
- `assets/` — templates and static files

## Converting Existing Scripts

1. Create `skill-name/` directory
2. Write `SKILL.md` explaining when/how to use the script
3. Move script to `scripts/your-script.sh`
4. Reference in SKILL.md: `Run scripts/your-script.sh`

## Editing Existing Skills

1. Read current SKILL.md
2. Identify changes from user feedback
3. Edit while keeping same `name` (must match directory)
4. Move growing content to `references/`

## Progressive Disclosure

Skills load in three tiers:

| Tier | Content | When Loaded |
|------|---------|-------------|
| 1 | `name` + `description` | Always (startup) |
| 2 | SKILL.md body | When skill activates |
| 3 | Referenced files | As needed |

Keep SKILL.md lean. Link to reference files:

```markdown
See [API Reference](references/api.md) for details.
Run scripts/process.sh for batch processing.
```

## Description Best Practices

The `description` triggers skill activation. Be specific about **when** to use:

**Good:**
```yaml
description: Extracts text from PDFs, fills forms, merges files. Use when working with PDF documents, forms, or extracting document content.
```

**Poor:**
```yaml
description: Helps with PDFs.
```

## Validation Checklist

- [ ] `name` matches parent directory exactly
- [ ] `name` is 1-64 chars, lowercase a-z/0-9/hyphens only
- [ ] No leading, trailing, or consecutive hyphens
- [ ] `description` is 1-1024 chars with trigger contexts
- [ ] SKILL.md under 500 lines
- [ ] File references use relative paths
- [ ] Detailed docs in `references/`

## Full Specification

See [Agent Skills Specification](references/specification.md) for:

- Complete frontmatter field reference
- Validation rules and error handling
- Name collision resolution
- Complete examples for each skill type
- Common patterns and best practices
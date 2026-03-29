# Agent Skills Specification

The complete specification for creating skills that work across agent implementations.

## File Structure

```
skill-name/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional: executable helper scripts
├── references/           # Optional: detailed documentation
└── assets/               # Optional: static resources (templates, images)
```

## SKILL.md Format

A SKILL.md file consists of YAML frontmatter followed by Markdown instructions:

```markdown
---
name: skill-name
description: What this skill does and when to use it.
---

# Skill Title

Instructions for the agent...
```

## Frontmatter Fields

### Required Fields

#### `name`

- **Type:** String
- **Required:** Yes
- **Constraints:**
  - 1-64 characters
  - Lowercase letters (a-z), digits (0-9), and hyphens (-) only
  - Cannot start or end with a hyphen
  - Cannot contain consecutive hyphens
  - Must match the parent directory name

**Valid examples:**
- `pdf-processing`
- `data-analysis`
- `code-review-2`

**Invalid examples:**
- `PDF-Processing` (uppercase)
- `-pdf` (starts with hyphen)
- `pdf--processing` (consecutive hyphens)

#### `description`

- **Type:** String
- **Required:** Yes
- **Constraints:**
  - 1-1024 characters
  - Non-empty

Should describe both what the skill does AND when to use it. Include trigger contexts.

**Good:**
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents, forms, or when the user mentions PDFs, extracting text, or document processing.
```

**Poor:**
```yaml
description: Helps with PDFs.
```

### Optional Fields

#### `license`

- **Type:** String
- **Required:** No
- Format: License name or reference to bundled license file

```yaml
license: MIT
license: Apache-2.0
license: Proprietary. See LICENSE.txt for terms.
```

#### `compatibility`

- **Type:** String
- **Required:** No
- **Constraints:** Max 500 characters
- Purpose: Indicates environment requirements

```yaml
compatibility: Requires Python 3.10+ and pandas
compatibility: Designed for Claude Code (or similar products)
compatibility: Requires git, docker, and network access
```

#### `metadata`

- **Type:** Object (key-value string mapping)
- **Required:** No
- Purpose: Additional properties not defined by spec

```yaml
metadata:
  author: your-name
  version: "1.0.0"
  category: productivity
```

#### `allowed-tools`

- **Type:** String (space-delimited list)
- **Required:** No
- Purpose: Pre-approved tools that don't require user confirmation
- Status: Experimental - support varies by implementation

```yaml
allowed-tools: Bash(git:*) Read Write
allowed-tools: Bash(npm:*) Bash(node:*)
```

## Progressive Disclosure

Skills load content in three tiers to optimize context usage:

| Tier | Content | Tokens | When Loaded |
|------|---------|--------|-------------|
| 1 | `name` + `description` | ~100 | Startup (always) |
| 2 | SKILL.md body | <5000 recommended | When skill activates |
| 3 | Referenced files | Unlimited | As needed |

**Best practice:** Keep SKILL.md under 500 lines. Move detailed docs to `references/`.

## Directory Contents

### scripts/

Executable files the agent can invoke:

```
scripts/
├── process.py
├── analyze.sh
└── helpers/
    └── utils.js
```

Best practices:
- Self-contained or clearly document dependencies
- Include helpful error messages
- Handle edge cases gracefully
- Exit with appropriate status codes

### references/

Documentation loaded on demand:

```
references/
├── api-reference.md
├── forms.md
└── domain-guide.md
```

Keep individual files focused and under 300 lines.

### assets/

Static resources:

```
assets/
├── template.json
├── schema.xsd
└── diagram.png
```

## File References

Always use paths relative to the skill directory:

```markdown
See [API Reference](references/api-reference.md) for details.
Run the helper: scripts/process.sh
Use the template: assets/template.json
```

Avoid nested references like `references/deep/nested/path.md`.

## Validation

### Manual Checklist

- [ ] `name` matches parent directory exactly
- [ ] `name` is 1-64 characters, lowercase a-z/0-9/hyphens only
- [ ] No leading, trailing, or consecutive hyphens in `name`
- [ ] `description` is 1-1024 characters
- [ ] `description` includes "when to use" context
- [ ] SKILL.md body has clear, actionable instructions
- [ ] File references use relative paths
- [ ] SKILL.md is under 500 lines
- [ ] Large docs moved to `references/`
- [ ] Scripts are executable and have error handling

### Using the Validator

```bash
skills-ref validate ./my-skill
```

## Name Collision Handling

When multiple skills have the same name from different sources:
- First skill found wins (discovery order depends on implementation)
- Warning is typically logged
- Use unique names to avoid conflicts

## Complete Example

```
pdf-tools/
├── SKILL.md
├── scripts/
│   ├── extract-text.py
│   └── merge-pdfs.sh
├── references/
│   └── api.md
└── assets/
    └── form-template.pdf
```

**SKILL.md:**
```markdown
---
name: pdf-tools
description: Extract text and tables from PDFs, fill forms, merge files. Use when working with PDF documents, forms, or extracting content from PDFs.
license: MIT
compatibility: Requires Python 3.10+ with PyPDF2
metadata:
  author: example-org
  version: "1.0.0"
---

# PDF Tools

Tools for working with PDF documents.

## Setup

Install dependencies:
\`\`\`bash
pip install PyPDF2 pdfplumber
\`\`\`

## Extract Text

\`\`\`bash
scripts/extract-text.py input.pdf
\`\`\`

## Merge PDFs

\`\`\`bash
scripts/merge-pdfs.sh file1.pdf file2.pdf output.pdf
\`\`\`

## Fill Forms

Use the form template in `assets/form-template.pdf`.

For advanced usage, see [API Reference](references/api.md).
```

## Common Patterns

### Single-Tool Skill

For skills wrapping a single tool or API:

```yaml
---
name: weather
description: Get current weather for any location. Use when the user asks about weather, temperature, or conditions.
---

# Weather

Fetch weather data for any city or coordinates.

## Usage

\`\`\`bash
scripts/get-weather.sh "City Name"
\`\`\`
```

### Multi-Step Workflow

For skills implementing a workflow:

```yaml
---
name: deploy
description: Deploy applications to cloud platforms. Use when deploying, releasing, or pushing code to production.
---

# Deploy

Multi-step deployment workflow.

## Steps

1. **Build** - Run tests and build artifacts
2. **Stage** - Deploy to staging environment  
3. **Verify** - Run smoke tests
4. **Release** - Promote to production

Each step has scripts in `scripts/`. See workflow details in `references/workflow.md`.
```

### Reference Library

For skills providing domain knowledge:

```yaml
---
name: api-reference
description: REST API design patterns, best practices, and code templates. Use when designing APIs, writing API documentation, or implementing API endpoints.
---

# API Reference

Comprehensive guide to REST API design.

## Topics

- Authentication patterns
- Error handling
- Rate limiting
- Versioning

See individual reference files for details.
```
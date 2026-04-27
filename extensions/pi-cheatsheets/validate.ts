/**
 * Pi Cheatsheets Validation — format spec checks for .mmem.yml files.
 *
 * Validates: YAML frontmatter fields, required sections, backtick commands,
 * token budget, date format, confidence values, and staleness.
 */

import type { ValidationResult } from "./types.js";
import { parseFrontmatter } from "./parse.js";
import { estimateTokens } from "./format.js";

// ── Constants ────────────────────────────────────────────────────

const REQUIRED_FIELDS = ["tool", "version", "updated", "category", "tags", "confidence"] as const;
const VALID_CONFIDENCE = ["high", "medium", "low"];
const REQUIRED_SECTIONS = ["## Common operations", "## Gotchas"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_BUDGET = 500;

// ── Validation ───────────────────────────────────────────────────

export function validateMemory(raw: string, _name?: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Must start with ---
	if (!raw.trimStart().startsWith("---")) {
		errors.push("File must start with YAML frontmatter (---)");
		return { valid: false, errors, warnings };
	}

	const parsed = parseFrontmatter(raw);
	if (!parsed) {
		errors.push("Could not parse YAML frontmatter (missing closing ---)");
		return { valid: false, errors, warnings };
	}

	const { meta, body } = parsed;

	// Required fields
	for (const field of REQUIRED_FIELDS) {
		if (!meta[field]) {
			errors.push(`Missing required field: ${field}`);
		}
	}

	// updated format
	if (meta.updated && !DATE_RE.test(String(meta.updated))) {
		errors.push(`'updated' must be YYYY-MM-DD format (got "${meta.updated}")`);
	}

	// confidence value
	if (meta.confidence && !VALID_CONFIDENCE.includes(String(meta.confidence))) {
		errors.push(`'confidence' must be high, medium, or low (got "${meta.confidence}")`);
	}

	// tags must be a list
	if (meta.tags && !Array.isArray(meta.tags)) {
		errors.push("'tags' must be a YAML list (e.g. [tag1, tag2])");
	}

	// Required body sections
	for (const section of REQUIRED_SECTIONS) {
		if (!body.includes(section)) {
			errors.push(`Missing required section: ${section}`);
		}
	}

	// Commands should be in backticks
	const codeLines = body.split("\n").filter((l) => l.trim().startsWith("`"));
	if (codeLines.length === 0) {
		warnings.push("No backtick-wrapped commands found in body");
	}

	// Token budget
	const tokens = estimateTokens(raw);
	if (tokens > TOKEN_BUDGET) {
		warnings.push(`Estimated ${tokens} tokens exceeds ${TOKEN_BUDGET} budget — consider splitting`);
	}

	// Staleness check (> 12 months)
	if (meta.updated && DATE_RE.test(String(meta.updated))) {
		const updatedDate = new Date(String(meta.updated));
		const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
		if (updatedDate < twelveMonthsAgo) {
			warnings.push(`Last updated ${meta.updated} — may be stale (>12 months old)`);
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}
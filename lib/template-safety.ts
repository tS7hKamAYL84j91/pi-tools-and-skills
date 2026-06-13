/** Deterministic safety checks for explicit synthetic template-pack fixtures. */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface TemplateSafetyFinding {
	path: string;
	ruleId: string;
	message: string;
	line: number;
}

export interface TemplateSafetyResult {
	checked: string[];
	findings: TemplateSafetyFinding[];
}

interface Rule {
	id: string;
	message: string;
	pattern: RegExp;
}

const RULES: Rule[] = [
	{
		id: "secret-placeholder",
		message: "Template asks for secret-like placeholders; use claim-checks or documented env setup instead.",
		pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key|secret)\b/gi,
	},
	{
		id: "private-path",
		message: "Template references private local paths that are out of scope for public fixtures.",
		pattern: /(?:\.workers|\.env|~\/\.ssh|keychain|credential store)/gi,
	},
	{
		id: "raw-session-request",
		message: "Template requests raw sessions/transcripts instead of bounded summaries or claim-checks.",
		pattern: /\braw\s+(?:session|transcript|conversation|prompt|tool payload)s?\b/gi,
	},
];

function displayPath(cwd: string, path: string): string {
	const rel = relative(cwd, path);
	return rel.startsWith("..") ? path : rel;
}

function lineNumber(content: string, index: number): number {
	return content.slice(0, index).split("\n").length;
}

function explicitFixturePath(cwd: string, path: string): string {
	const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const rel = relative(cwd, absolute);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`template safety path must stay under cwd: ${path}`);
	}
	if (!rel.startsWith("tests/fixtures/template-safety/")) {
		throw new Error(`template safety POC only accepts explicit synthetic fixture paths: ${path}`);
	}
	return absolute;
}

/** Check only caller-listed synthetic fixture files; never discovers paths. */
export async function checkTemplateSafety(paths: readonly string[], cwd = process.cwd()): Promise<TemplateSafetyResult> {
	const checked: string[] = [];
	const findings: TemplateSafetyFinding[] = [];
	for (const inputPath of paths) {
		const absolute = explicitFixturePath(cwd, inputPath);
		const visiblePath = displayPath(cwd, absolute);
		checked.push(visiblePath);
		const content = await readFile(absolute, "utf8");
		for (const rule of RULES) {
			for (const match of content.matchAll(rule.pattern)) {
				findings.push({ path: visiblePath, ruleId: rule.id, message: rule.message, line: lineNumber(content, match.index ?? 0) });
			}
		}
	}
	findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
	return { checked, findings };
}

export function formatTemplateSafetyResult(result: TemplateSafetyResult): string {
	if (result.findings.length === 0) {
		return `Template safety PASS: checked ${result.checked.length} fixture(s).`;
	}
	return [
		`Template safety FAIL: ${result.findings.length} finding(s) in ${result.checked.length} fixture(s).`,
		...result.findings.map((finding) => `${finding.path}:${finding.line} ${finding.ruleId} — ${finding.message}`),
	].join("\n");
}

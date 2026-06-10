/** UX and tool-surface policy fitness functions. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles, sourceFiles, stringLiteralMatches } from "./helpers.js";

describe("UX and tools policy", () => {
	it("registered slash commands use kebab-case names", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			const content = readFileSync(file, "utf8");
			for (const command of stringLiteralMatches(content, /registerCommand\(\s*["']([^"']+)["']/g)) {
				if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(command)) {
					violations.push(`${relative(process.cwd(), file)} registers /${command}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("registered model tools use snake_case names", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			const content = readFileSync(file, "utf8");
			for (const tool of stringLiteralMatches(content, /registerTool\(\s*\{[\s\S]*?\bname:\s*["']([^"']+)["']/g)) {
				if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(tool)) {
					violations.push(`${relative(process.cwd(), file)} registers ${tool}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("runtime TUI code must not use raw ANSI escape sequences", () => {
		const violations: string[] = [];
		const escapeSequence = `${String.fromCharCode(27)}[`;
		for (const file of sourceFiles()) {
			const content = readFileSync(file, "utf8");
			if (content.includes("\\x1b[") || content.includes("\\u001b[") || content.includes(escapeSequence)) {
				violations.push(relative(process.cwd(), file));
			}
		}
		expect(violations).toEqual([]);
	});

	it("custom TUI overlays declare bounded overlay options", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			const content = readFileSync(file, "utf8");
			if (!/overlay:\s*true/.test(content)) continue;
			for (const field of ["width", "minWidth", "maxHeight", "anchor", "margin"]) {
				if (!new RegExp(`\\b${field}:`).test(content)) {
					violations.push(`${relative(process.cwd(), file)} missing overlayOptions.${field}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("destructive confirmation footers use the standard cancel wording", () => {
		const violations: string[] = [];
		for (const file of sourceFiles()) {
			const content = readFileSync(file, "utf8");
			for (const footer of stringLiteralMatches(content, /["']([^"']*confirm[^"']*cancel[^"']*)["']/g)) {
				if (!footer.includes("[y] confirm") || !footer.includes("[esc/n] cancel")) {
					violations.push(`${relative(process.cwd(), file)} uses ${footer}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});
});

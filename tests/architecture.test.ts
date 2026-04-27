/**
 * Architectural fitness functions for extensions and shared library code.
 *
 * These tests enforce structural invariants that keep the codebase healthy.
 * They run alongside unit tests and catch architectural violations before they ship.
 *
 * Uses ArchUnitTS (https://github.com/LukasNiessen/ArchUnitTS)
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { projectFiles, metrics } from "archunit";

function listTsFiles(root: string): string[] {
	const files: string[] = [];
	if (!existsSync(root)) return files;
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		if (statSync(path).isDirectory()) {
			files.push(...listTsFiles(path));
		} else if (path.endsWith(".ts")) {
			files.push(path);
		}
	}
	return files;
}

function extensionNames(): string[] {
	return readdirSync("extensions").filter((name) =>
		statSync(join("extensions", name)).isDirectory(),
	);
}

function localImportSpecifiers(content: string): string[] {
	// Covers relative ESM imports/re-exports used in this repo. It intentionally
	// does not resolve future tsconfig aliases; add alias handling if we adopt one.
	const importPattern =
		/from\s+["'](\.\.?\/[^"']+)["']|import\s+["'](\.\.?\/[^"']+)["']|import\s*\([^)]*["'](\.\.?\/[^"']+)["'][^)]*\)/g;
	return [...content.matchAll(importPattern)].map(
		(match) => match[1] ?? match[2] ?? match[3] ?? "",
	).filter(Boolean);
}

// ── 1. Dependency Direction: lib/ never imports from extensions/ ─────

describe("dependency direction", () => {
	it("lib/ must not import from extensions/", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.shouldNot()
			.dependOnFiles()
			.inFolder("extensions/**");

		await expect(rule).toPassAsync();
	});

	it("lib/ must not import from tests/", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.shouldNot()
			.dependOnFiles()
			.inFolder("tests/**");

		await expect(rule).toPassAsync();
	});
});

// ── 2. Extension leaf isolation: types.ts has no sibling imports ─────

describe("types.ts leaf isolation", () => {
	it("types.ts must not import from sibling extension modules", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			if (!file.endsWith(`${sep}types.ts`)) continue;
			const content = readFileSync(file, "utf8");
			const localSpecifiers = localImportSpecifiers(content).filter((specifier) =>
				specifier.startsWith("./"),
			);
			for (const specifier of localSpecifiers) {
				violations.push(`${relative(process.cwd(), file)} -> ${specifier}`);
			}
		}

		expect(violations).toEqual([]);
	});
});

// ── 3. No cross-extension imports ───────────────────────────────────

describe("extension isolation", () => {
	it("extensions must not import from other extensions", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			const relativeFile = relative(process.cwd(), file);
			const [, sourceExtension] = relativeFile.split(sep);
			if (!sourceExtension) continue;

			const content = readFileSync(file, "utf8");
			for (const specifier of localImportSpecifiers(content)) {
				const target = normalize(join(dirname(file), specifier));
				const relativeTarget = relative(process.cwd(), target);
				const [root, targetExtension] = relativeTarget.split(sep);
				if (root === "extensions" && targetExtension !== sourceExtension) {
					violations.push(`${relativeFile} -> ${specifier}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});

// ── 4. No circular dependencies ─────────────────────────────────────

describe("circular dependencies", () => {
	it("each extension should be cycle-free", async () => {
		for (const extensionName of extensionNames()) {
			const rule = projectFiles()
				.inFolder(`extensions/${extensionName}/**`)
				.should()
				.haveNoCycles();

			await expect(rule).toPassAsync();
		}
	});

	it("lib modules should be cycle-free", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.should()
			.haveNoCycles();

		await expect(rule).toPassAsync();
	});
});

// ── 5. File size limits ─────────────────────────────────────────────

describe("file size", () => {
	it("no extension file should exceed 600 lines", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) => {
					const lines = file.content.split("\n").length;
					return lines <= 600;
				},
				"Extension files should not exceed 600 lines",
			);

		await expect(rule).toPassAsync();
	});

	it("no lib file should exceed 200 lines", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.should()
			.adhereTo(
				(file) => {
					const lines = file.content.split("\n").length;
					return lines <= 200;
				},
				"Lib files should not exceed 200 lines",
			);

		await expect(rule).toPassAsync();
	});
});

// ── 6. No sync filesystem I/O in render paths ──────────────────────

describe("render path safety", () => {
	it("readAllPeers must not be called inside render() closures", async () => {
		const rule = projectFiles()
			.inFolder("extensions/pi-panopticon/**")
			.should()
			.adhereTo(
				(file) => {
					const renderPattern = /render\s*\([^)]*\)\s*(?::\s*\w+(?:\[\])?\s*)?\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
					for (const match of file.content.matchAll(renderPattern)) {
						if (match[1]?.includes("readAllPeers")) {
							return false;
						}
					}
					return true;
				},
				"readAllPeers() must not be called inside render() functions (causes sync I/O per paint frame)",
			);

		await expect(rule).toPassAsync();
	});
});

// ── 7. Every extension module has a doc comment ─────────────────────

describe("documentation", () => {
	it("every extension .ts file should start with a JSDoc comment", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) => file.content.trimStart().startsWith("/**"),
				"Extension files must start with a /** JSDoc */ module comment",
			);

		await expect(rule).toPassAsync();
	});
});

// ── 8. Clean Code: Function parameter limits (Bob Martin: ≤3) ───

function countFuncParams(content: string, maxParams: number): boolean {
	const funcPattern = /function\s+\w+\s*\(([^)]*?)\)/g;
	for (const match of content.matchAll(funcPattern)) {
		const params = match[1]?.replace(/,\s*$/, "").trim();
		if (!params) continue;
		let depth = 0;
		let count = 1;
		for (const ch of params) {
			if (ch === "<" || ch === "(") depth++;
			else if (ch === ">" || ch === ")") depth--;
			else if (ch === "," && depth === 0) count++;
		}
		if (count > maxParams) return false;
	}
	return true;
}

function allowsParameterException(path: string): boolean {
	// applyEvent() consumes one parsed log event: task, event, agent, timestamp,
	// and key/value payload. This is legacy event-sourcing core, not new API shape.
	return path.endsWith("extensions/kanban/board.ts");
}

describe("function parameters", () => {
	it("extension functions should have at most 4 parameters", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) =>
					allowsParameterException(file.path) ||
					countFuncParams(file.content, 4),
				"Functions should have at most 4 parameters (Clean Code: 3 ideal, 4 max)",
			);

		await expect(rule).toPassAsync();
	});

	it("lib functions should have at most 4 parameters", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.should()
			.adhereTo(
				(file) => countFuncParams(file.content, 4),
				"Functions should have at most 4 parameters (Clean Code: 3 ideal, 4 max)",
			);

		await expect(rule).toPassAsync();
	});
});

// ── 9. Clean Code: Class cohesion (LCOM) ─────────────────────────

describe("class cohesion", () => {
	it("classes should have high cohesion (LCOM96b < 0.8)", async () => {
		const rule = metrics()
			.inFolder("extensions/**")
			.lcom()
			.lcom96b()
			.shouldBeBelow(0.8);

		await expect(rule).toPassAsync({ allowEmptyTests: true });
	});
});

// ── 10. Clean Code: No empty catch blocks ────────────────────────

describe("error handling", () => {
	it("catch blocks must contain at least a comment", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) => {
					const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
					return !emptyCatch.test(file.content);
				},
				"Empty catch blocks must have a comment explaining why the error is ignored",
			);

		await expect(rule).toPassAsync();
	});
});

// ── 11. Module structure: single entry point per extension ───────

describe("module structure", () => {
	it("index.ts should have exactly one default export", async () => {
		const rule = projectFiles()
			.withName("index.ts")
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) => {
					const defaults = file.content.match(/export default/g);
					return defaults !== null && defaults.length === 1;
				},
				"Extension index.ts must have exactly one default export (the entry point)",
			);

		await expect(rule).toPassAsync();
	});
});

/**
 * Architectural fitness functions for the pi-panopticon extension.
 *
 * These tests enforce structural invariants that keep the codebase healthy.
 * They run alongside unit tests and catch architectural violations before they ship.
 *
 * Uses ArchUnitTS (https://github.com/LukasNiessen/ArchUnitTS)
 */

import { describe, it, expect } from "vitest";
import { projectFiles, metrics } from "archunit";

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

	it("lib/ must not import from project-extensions/", async () => {
		const rule = projectFiles()
			.inFolder("lib/**")
			.shouldNot()
			.dependOnFiles()
			.inFolder("project-extensions/**");

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
	it("types.ts must not import from sibling extension modules", async () => {
		const rule = projectFiles()
			.withName("types.ts")
			.shouldNot()
			.dependOnFiles()
			.withName(/^(registry|messaging|spawner|peek|ui|index)\.ts$/);

		await expect(rule).toPassAsync();
	});
});

// ── 3. No cross-extension imports ───────────────────────────────────

describe("extension isolation", () => {
	it("extensions must not import from other extensions", async () => {
		// Each extension folder should only depend on lib/ and its own files.
		// If a second extension is added, this catches cross-imports.
		// allowEmptyTests: only one extension exists currently, so the target pattern matches nothing.
		const rule = projectFiles()
			.inFolder("extensions/pi-panopticon/**")
			.shouldNot()
			.dependOnFiles()
			.inPath(/extensions\/(?!pi-panopticon\/).*/);

		await expect(rule).toPassAsync({ allowEmptyTests: true });
	});
});

// ── 4. No circular dependencies ─────────────────────────────────────

describe("circular dependencies", () => {
	it("extension modules should be cycle-free", async () => {
		const rule = projectFiles()
			.inFolder("extensions/pi-panopticon/**")
			.should()
			.haveNoCycles();

		await expect(rule).toPassAsync();
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
	it("no global extension file should exceed 500 lines", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) => {
					const lines = file.content.split("\n").length;
					return lines <= 500;
				},
				"Extension files should not exceed 500 lines (Clean Code: 200 ideal, 500 upper bound)",
			);

		await expect(rule).toPassAsync();
	});

	it("project-extensions files should not exceed 600 lines", async () => {
		const rule = projectFiles()
			.inFolder("project-extensions/**")
			.should()
			.adhereTo(
				(file) => {
					const lines = file.content.split("\n").length;
					return lines <= 600;
				},
				"project-extensions files should not exceed 600 lines",
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
	it("readAllPeers must not be called inside render() closures in ui.ts", async () => {
		const rule = projectFiles()
			.withName("ui.ts")
			.should()
			.adhereTo(
				(file) => {
					// Find render() function bodies and check for readAllPeers
					const renderPattern = /render\s*\([^)]*\)\s*(?::\s*\w+(?:\[\])?\s*)?\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
					let match;
					while ((match = renderPattern.exec(file.content)) !== null) {
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
			.inFolder("extensions/pi-panopticon/**")
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
	let match;
	while ((match = funcPattern.exec(content)) !== null) {
		// Strip trailing comma and whitespace before counting
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

describe("function parameters", () => {
	it("extension functions should have at most 4 parameters", async () => {
		const rule = projectFiles()
			.inFolder("extensions/**")
			.should()
			.adhereTo(
				(file) => countFuncParams(file.content, 4),
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
					// Match catch blocks with absolutely nothing inside
					// Our codebase uses `catch { /* comment */ }` which is acceptable
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

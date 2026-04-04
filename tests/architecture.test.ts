/**
 * Architectural fitness functions for the pi-panopticon extension.
 *
 * These tests enforce structural invariants that keep the codebase healthy.
 * They run alongside unit tests and catch architectural violations before they ship.
 *
 * Uses ArchUnitTS (https://github.com/LukasNiessen/ArchUnitTS)
 */

import { describe, it, expect } from "vitest";
import { projectFiles } from "archunit";

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
	it("no extension file should exceed 500 lines", async () => {
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

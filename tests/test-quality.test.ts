/**
 * Fitness functions for test-suite quality.
 *
 * These checks keep normal unit tests deterministic, quiet, and broad enough to
 * protect each shipped extension. Long-running/noisy stress behavior belongs in
 * explicitly named soak tests.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

function listFiles(root: string, suffix: string): string[] {
	const files: string[] = [];
	if (!existsSync(root)) {
		return files;
	}
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		if (statSync(path).isDirectory()) {
			files.push(...listFiles(path, suffix));
		} else if (path.endsWith(suffix)) {
			files.push(path);
		}
	}
	return files;
}

function testFiles(): string[] {
	return listFiles("tests", ".test.ts");
}

function extensionNames(): string[] {
	return readdirSync("extensions").filter((entry) =>
		statSync(join("extensions", entry)).isDirectory(),
	);
}

function isSoakTest(file: string): boolean {
	// Soak tests intentionally report stress metrics and may use randomness to
	// exercise many routing paths. Keep that behavior isolated by filename.
	return basename(file) === "soak.test.ts";
}

describe("test quality fitness functions", () => {
	it("test files must not contain focused tests", () => {
		const violations = testFiles().filter((file) => /\b(?:describe|it|test)\.only\s*\(/.test(readFileSync(file, "utf8")));
		expect(violations).toEqual([]);
	});

	it("regular tests should not leave diagnostic console.log output", () => {
		const violations = testFiles()
			.filter((file) => !isSoakTest(file))
			.filter((file) => /\bconsole\.log\s*\(/.test(readFileSync(file, "utf8")));
		expect(violations).toEqual([]);
	});

	it("regular tests should not use Math.random", () => {
		const violations = testFiles()
			.filter((file) => !isSoakTest(file))
			.filter((file) => /\bMath\.random\s*\(/.test(readFileSync(file, "utf8")));
		expect(violations).toEqual([]);
	});

	it("each shipped extension should have at least one direct test file", () => {
		// The package ships every top-level extensions/<name>/ directory, so each
		// directory should have at least one matching tests/<name>-*.test.ts file.
		const tests = testFiles().map((file) => basename(file));
		const missing = extensionNames().filter((extension) =>
			!tests.some((testFile) => testFile.startsWith(`${extension}-`)),
		);
		expect(missing).toEqual([]);
	});

	it("each shipped pi extension should document its boundary", () => {
		const missing = extensionNames().filter((extension) => {
			const readme = join("extensions", extension, "README.md");
			return !existsSync(readme) || !readFileSync(readme, "utf8").includes("## What this does NOT do");
		});
		expect(missing).toEqual([]);
	});
});

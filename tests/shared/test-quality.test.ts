/**
 * Fitness functions for test-suite quality.
 *
 * These checks keep normal unit tests deterministic, quiet, and broad enough to
 * protect each shipped extension. Long-running/noisy stress behavior belongs in
 * explicitly named soak tests.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const TEST_FILE_MAX_LINES = 1_000;

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

function lineCount(file: string): number {
	return readFileSync(file, "utf8").split("\n").length;
}

function existenceOnlyTestNames(content: string): string[] {
	return [...content.matchAll(/\b(?:it|test)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:async\s*)?\(?(?:[^)=]*)\)?\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)/g)]
		.filter((match) => {
			const body = match[2] ?? "";
			const expects = body.match(/\bexpect\s*\(/g)?.length ?? 0;
			return expects === 1 && /\.(?:toBeDefined|toBeTruthy)\s*\(\s*\)/.test(body);
		})
		.map((match) => match[1] ?? "")
		.filter(Boolean);
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

	it("test files stay under the single line budget", () => {
		const violations = listFiles("tests", ".ts")
			.map((file) => relative(process.cwd(), file))
			.map((path) => ({ path, lines: lineCount(path) }))
			.filter((file) => file.lines > TEST_FILE_MAX_LINES)
			.map((file) => `${file.path}: ${file.lines}/${TEST_FILE_MAX_LINES} lines`);

		expect(violations).toEqual([]);
	});

	it("tests avoid existence-only vanity test cases", () => {
		const violations = testFiles()
			.flatMap((file) =>
				existenceOnlyTestNames(readFileSync(file, "utf8"))
					.map((name) => `${relative(process.cwd(), file)}: ${name}`),
			);

		expect(violations).toEqual([]);
	});

	it("architecture suites stay under tests/architecture", () => {
		const violations = testFiles()
			.map((file) => relative(process.cwd(), file))
			.filter((file) => file.includes("architecture") && file !== "tests/architecture.test.ts");

		expect(violations).toEqual([]);
	});

	it("tests do not reference removed standalone council extension paths", () => {
		const violations = testFiles()
			.filter((file) => /extensions\/(?:council|pi-teams)\//.test(readFileSync(file, "utf8")))
			.map((file) => relative(process.cwd(), file));

		expect(violations).toEqual([]);
	});

	it("each shipped extension should have at least one direct test file", () => {
		// The package ships every top-level extensions/<name>/ directory, so each
		// directory should have at least one matching test filename.
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

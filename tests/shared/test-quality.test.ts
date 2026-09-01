/**
 * Fitness functions for test-suite quality.
 *
 * These checks keep normal unit tests deterministic, quiet, and broad enough to
 * protect each shipped extension. Long-running/noisy stress behavior belongs in
 * explicitly named soak tests.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const TEST_FILE_MAX_LINES = 1_000;

/** Production roots whose modules must be production-reachable (ADR-054). */
const PRODUCTION_MODULE_ROOTS = ["extensions", "lib", join("daemon", "src")];

/** Roots scanned for importers: production roots plus tests and script CLIs. */
const IMPORTER_SCAN_ROOTS = [...PRODUCTION_MODULE_ROOTS, "tests", "scripts"];

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

/** Test files live under tests/ or are co-located as *.test.ts inside extensions. */
function isTestFile(file: string): boolean {
	const path = relative(process.cwd(), file);
	return path.endsWith(".test.ts") || path.startsWith(`tests${sep}`);
}

// Entry files are excluded from the rule's target set by definition, not by
// exemption: extension entry/barrel files (any path ending in index.ts) are
// reached through package pi.extensions manifests, and every daemon/src/*.ts
// is a published entry root (knip entry list; the daemon main plus the operator
// admin CLI), so import-graph reachability does not apply to them.
function isProductionEntry(path: string): boolean {
	if (path.endsWith(`${sep}index.ts`)) {
		return true;
	}
	const daemonSrcPrefix = join("daemon", "src") + sep;
	return (
		path.startsWith(daemonSrcPrefix) &&
		!path.slice(daemonSrcPrefix.length).includes(sep)
	);
}

/** Resolve a relative import specifier to a repo-local .ts file, or null. */
function resolveLocalImport(
	fromFile: string,
	specifier: string,
): string | null {
	const base = resolve(dirname(fromFile), specifier);
	const candidates = [
		base.replace(/\.js$/, ".ts"),
		`${base}.ts`,
		join(base, "index.ts"),
	];
	return (
		candidates.find(
			(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
		) ?? null
	);
}

function existenceOnlyTestNames(content: string): string[] {
	return [
		...content.matchAll(
			/\b(?:it|test)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:async\s*)?\(?(?:[^)=]*)\)?\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)/g,
		),
	]
		.filter((match) => {
			const body = match[2] ?? "";
			const expects = body.match(/\bexpect\s*\(/g)?.length ?? 0;
			return (
				expects === 1 && /\.(?:toBeDefined|toBeTruthy)\s*\(\s*\)/.test(body)
			);
		})
		.map((match) => match[1] ?? "")
		.filter(Boolean);
}

/**
 * No-exemptions fitness rule (ADR-054): list production modules whose
 * importers are all test files, or which have zero importers. Single pass
 * over the importer-scan roots keeps the check deterministic and fast;
 * there are no allowlists.
 */
function testOnlyProductionModules(): string[] {
	const importPatterns = [
		/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
		/\bimport\s+["'](\.{1,2}\/[^"']+)["']/g,
		/\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']/g,
	];
	const importersByModule = new Map<string, Set<string>>();
	for (const file of IMPORTER_SCAN_ROOTS.flatMap((root) =>
		listFiles(root, ".ts"),
	)) {
		const content = readFileSync(file, "utf8");
		for (const pattern of importPatterns) {
			for (const match of content.matchAll(pattern)) {
				const specifier = match[1] ?? "";
				const module = specifier ? resolveLocalImport(file, specifier) : null;
				if (!module) {
						continue;
				}
				const importers = importersByModule.get(module) ?? new Set<string>();
				importers.add(file);
				importersByModule.set(module, importers);
			}
		}
	}

	const violations: string[] = [];
	for (const file of PRODUCTION_MODULE_ROOTS.flatMap((root) =>
		listFiles(root, ".ts"),
	)) {
		const path = relative(process.cwd(), file);
		if (isTestFile(file) || isProductionEntry(path)) {
			continue;
		}
		const importers = [...(importersByModule.get(resolve(file)) ?? [])]
			.map((importer) => relative(process.cwd(), importer))
			.sort();
		const productionReachable = importers.some(
			(importer) => !isTestFile(importer),
		);
		if (productionReachable) {
			continue;
		}
		const detail =
			importers.length === 0
				? "zero importers"
				: `test-only importers: ${importers.join(", ")}`;
		violations.push(`${path} (${detail})`);
	}
	return violations.sort();
}

describe("test quality fitness functions", () => {
	it("test files must not contain focused tests", () => {
		const violations = testFiles().filter((file) =>
			/\b(?:describe|it|test)\.only\s*\(/.test(readFileSync(file, "utf8")),
		);
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
			.map(
				(file) => `${file.path}: ${file.lines}/${TEST_FILE_MAX_LINES} lines`,
			);

		expect(violations).toEqual([]);
	});

	it("tests avoid existence-only vanity test cases", () => {
		const violations = testFiles().flatMap((file) =>
			existenceOnlyTestNames(readFileSync(file, "utf8")).map(
				(name) => `${relative(process.cwd(), file)}: ${name}`,
			),
		);

		expect(violations).toEqual([]);
	});

	it("architecture suites stay under tests/architecture", () => {
		const violations = testFiles()
			.map((file) => relative(process.cwd(), file))
			.filter(
				(file) =>
					file.includes("architecture") &&
					file !== "tests/architecture.test.ts",
			);

		expect(violations).toEqual([]);
	});

	it("tests do not reference removed standalone council extension paths", () => {
		const violations = testFiles()
			.filter((file) =>
				/extensions\/council\//.test(readFileSync(file, "utf8")),
			)
			.map((file) => relative(process.cwd(), file));

		expect(violations).toEqual([]);
	});

	it("each shipped extension should have at least one direct test file", () => {
		// The package ships every top-level extensions/<name>/ directory, so each
		// directory should have at least one matching test filename.
		const tests = testFiles().map((file) => basename(file));
		const missing = extensionNames().filter(
			(extension) =>
				!tests.some((testFile) => testFile.startsWith(`${extension}-`)),
		);
		expect(missing).toEqual([]);
	});

	it("each shipped pi extension should document its boundary", () => {
		const missing = extensionNames().filter((extension) => {
			const readme = join("extensions", extension, "README.md");
			return (
				!existsSync(readme) ||
			!readFileSync(readme, "utf8").includes("## What this does NOT do")
		);
		});
		expect(missing).toEqual([]);
	});

	it("production modules must not survive on test-only importers", () => {
		// ADR-054 no-exemptions rule: a production module whose importers are all
		// test files — or which has zero importers — fails the suite. Test imports
		// mask dead production code from knip because tests/** is in its project.
		expect(testOnlyProductionModules()).toEqual([]);
	});
});

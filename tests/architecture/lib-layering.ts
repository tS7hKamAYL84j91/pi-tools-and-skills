/** Shared infrastructure has real production consumers, not test-only ones. */

import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles, localImportSpecifiers } from "./helpers.js";

const CORE_LIB_FILES = new Set([
	"agent-names.ts",
	"completion-signal.ts",
	"message-transport.ts",
	"secret-redaction.ts",
	"task-brief.ts",
	"tool-result.ts",
	"tui-confirmation.ts",
	"tui-overflow.ts",
]);

/** Generic infrastructure kept central for the reasons in lib/README.md. */
const SINGLE_CONSUMER_PRIMITIVES = new Set([
	"declarative-discovery.ts", "event-log.ts", "session-journal.ts",
	"session-spool.ts", "tui-overflow.ts",
]);

const NODE_IO_IMPORT = /from\s+["']node:(?:fs|fs\/promises|child_process|os)["']/;
const productionFiles = ["extensions", "lib", "scripts", "fleet-mcp"]
	.flatMap(listTsFiles)
	.filter((file) => !/\.(test|spec)\.ts$/.test(file));

function callersOf(target: string): Set<string> {
	const callers = new Set<string>();
	for (const file of productionFiles) {
		const content = readFileSync(file, "utf8");
		if (localImportSpecifiers(content).some((specifier) =>
			resolve(dirname(file), specifier.replace(/\.js$/, ".ts")) === resolve(target),
		)) callers.add(relative(process.cwd(), file));
	}
	return callers;
}

describe("lib layering", () => {
	it("every lib module has documented ownership and production consumers", () => {
		const inventory = readFileSync("lib/README.md", "utf8");
		const violations = listTsFiles("lib").flatMap((file) => {
			const fileName = basename(file);
			if (!inventory.includes(`\`${fileName}\``)) return [`${file} is undocumented`];
			const callers = callersOf(file);
			const minimum = SINGLE_CONSUMER_PRIMITIVES.has(fileName) ? 1 : 2;
			return callers.size >= minimum ? [] : [`${file} has ${callers.size} production caller(s)`];
		});
		expect(violations).toEqual([]);
	});

	it("does not count test references or unrelated basename matches as consumers", () => {
		expect(productionFiles.some((file) => file.startsWith("tests/") || file.endsWith(".test.ts"))).toBe(false);
		expect([...callersOf("lib/event-log.ts")]).toEqual(["extensions/pi-kanban/board-transactions.ts"]);
		expect(callersOf("not-a-library/event-log.ts").size).toBe(0);
	});

	it("core lib contracts and render helpers do not import Node IO modules", () => {
		const violations = listTsFiles("lib")
			.filter((file) => CORE_LIB_FILES.has(basename(file)))
			.filter((file) => NODE_IO_IMPORT.test(readFileSync(file, "utf8")))
			.map((file) => relative(process.cwd(), file));
		expect(violations).toEqual([]);
	});

	it("lib modules do not import from extension runtime", () => {
		const violations = listTsFiles("lib")
			.filter((file) => /from\s+["']\.\.\/extensions\//.test(readFileSync(file, "utf8")))
			.map((file) => relative(process.cwd(), file));
		expect(violations).toEqual([]);
	});
});

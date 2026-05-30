/** Repo-specific lib layering fitness functions. */

import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

const CORE_LIB_FILES = new Set([
	"agent-names.ts",
	"completion-signal.ts",
	"message-transport.ts",
	"oracle-judge.ts",
	"research-tool-fixtures.ts",
	"research-tool-manifest.ts",
	"spawn-events.ts",
	"spawn-rpc.ts",
	"task-brief.ts",
	"tool-result.ts",
	"tui-confirmation.ts",
	"tui-overflow.ts",
]);

const NODE_IO_IMPORT = /from\s+["']node:(?:fs|fs\/promises|child_process|os)["']/;

describe("lib layering", () => {
	it("core lib contracts and render helpers do not import Node IO modules", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("lib")) {
			if (!CORE_LIB_FILES.has(basename(file))) continue;
			const content = readFileSync(file, "utf8");
			if (NODE_IO_IMPORT.test(content)) {
				violations.push(relative(process.cwd(), file));
			}
		}
		expect(violations).toEqual([]);
	});

	it("lib modules do not import from extension runtime", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("lib")) {
			const content = readFileSync(file, "utf8");
			if (/from\s+["']\.\.\/extensions\//.test(content)) {
				violations.push(relative(process.cwd(), file));
			}
		}
		expect(violations).toEqual([]);
	});
});

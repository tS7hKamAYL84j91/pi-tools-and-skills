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
	"secret-redaction.ts",
	"task-brief.ts",
	"tool-result.ts",
	"tui-confirmation.ts",
	"tui-overflow.ts",
]);

const IO_LIB_FILES = new Set([
	"agent-api.ts",
	"agent-registry.ts",
	"coas-governance.ts",
	"file-lock.ts",
	"file-persistence.ts",
	"pi-settings.ts",
	"private-local-mode.ts",
	"session-hook-installer-cli.ts",
	"session-hook-installer.ts",
	"session-log.ts",
	"session-source-cli.ts",
	"session-source-discovery.ts",
	"session-spool-runner-cli.ts",
	"session-spool-runner.ts",
	"session-spool-select-cli.ts", // CLI wrapper: combines session-source-discovery + session-spool-runner IO modules
	"session-spool.ts",
	"spawn-events.ts",
	"spawn-rpc.ts",
	"spawn-service.ts",
	"runtime-child-process.ts",
	"template-safety.ts",
	"maildir.ts",
]);

const PURE_RUNTIME_LIB_FILES = new Set(["runtime-agent-messaging.ts", "runtime-control-plane.ts", "session-journal.ts"]);

const CLASSIFIED_LIB_FILES = new Set([
	...CORE_LIB_FILES,
	...IO_LIB_FILES,
	...PURE_RUNTIME_LIB_FILES,
]);

const NODE_IO_IMPORT = /from\s+["']node:(?:fs|fs\/promises|child_process|os)["']/;
const VALUE_RELATIVE_IMPORT = /^import\s+(?!type\b)[\s\S]*?from\s+["']\.\/?([^"']+)\.js["'];?$/gm;

describe("lib layering", () => {
	it("every lib TypeScript module is assigned to a documented layer", () => {
		const unclassified = listTsFiles("lib")
			.map((file) => relative(process.cwd(), file))
			.filter((file) => !CLASSIFIED_LIB_FILES.has(basename(file)));
		expect(unclassified).toEqual([]);
	});

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

	it("core lib contracts do not value-import higher IO/runtime layers", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("lib")) {
			const fileName = basename(file);
			if (!CORE_LIB_FILES.has(fileName)) continue;
			const content = readFileSync(file, "utf8");
			for (const match of content.matchAll(VALUE_RELATIVE_IMPORT)) {
				const imported = `${match[1]}.ts`;
				if (!CORE_LIB_FILES.has(basename(imported))) {
					violations.push(
						`${relative(process.cwd(), file)} value-imports ${match[1]}.js`,
					);
				}
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

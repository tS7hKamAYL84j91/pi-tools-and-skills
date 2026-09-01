/** Shared-lib fitness functions: `lib/` is reserved for multi-caller primitives. */

import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

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

/** Every entry is a deliberately shared primitive and has multiple callers. */
const SHARED_LIB_FILES = new Set([
	"admission.ts",
	"agent-api.ts",
	"agent-names.ts",
	"agent-registry.ts",
	"coas-config.ts",
	"coas-governance.ts",
	"coas-types.ts",
	"completion-signal.ts",
	"confined-store.ts",
	"declarative-discovery.ts",
	"file-lock.ts",
	"file-persistence.ts",
	"event-log.ts",
	"gate-command.ts",
	"message-transport.ts",
	"path-inside.ts",
	"paths.ts",
	"pi-settings.ts",
	"private-local-mode.ts",
	"registry-event-buffer.ts",
	"registry-protocol.ts",
	"registry-types.ts",
	"runtime-agent-messaging.ts",
	"runtime-child-process.ts",
	"runtime-control-plane.ts",
	"secret-redaction.ts",
	"session-hook-installer.ts",
	"session-journal.ts",
	"session-log.ts",
	"session-source-discovery.ts",
	"session-spool-runner.ts",
	"session-spool.ts",
	"task-brief.ts",
	"tool-result.ts",
	"tui-confirmation.ts",
	"tui-overflow.ts",
	"external-mailbox.ts",
	"maildir.ts",
]);

const NODE_IO_IMPORT = /from\s+["']node:(?:fs|fs\/promises|child_process|os)["']/;
function callersOf(fileName: string): Set<string> {
	const callers = new Set<string>();
	for (const file of [...listTsFiles("extensions"), ...listTsFiles("lib"), ...listTsFiles("tests"), ...listTsFiles("scripts")]) {
		const content = readFileSync(file, "utf8");
		if (content.includes(fileName.replace(/\.ts$/, ".js"))) callers.add(relative(process.cwd(), file));
	}
	return callers;
}

describe("lib layering", () => {
	it("every lib TypeScript module is a documented shared primitive with multiple callers", () => {
		const violations = listTsFiles("lib").flatMap((file) => {
			const fileName = basename(file);
			if (!SHARED_LIB_FILES.has(fileName)) return [`${relative(process.cwd(), file)} is undocumented`];
			const callers = callersOf(fileName);
			return callers.size >= 2 ? [] : [`${relative(process.cwd(), file)} has ${callers.size} caller(s)`];
		});
		expect(violations).toEqual([]);
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

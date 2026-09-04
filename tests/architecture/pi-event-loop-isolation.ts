/** pi-event-loop isolation and layer-boundary fitness checks (SPEC §2, §19; AC-9, AC-23..25). */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles, localImportSpecifiers } from "./helpers.js";

const EXTENSION = "extensions/pi-event-loop";

/**
 * Pure projection/storage layer: builds views from facts and issues nothing.
 * Projectors must never import the automation or delivery layers (SPEC §9, AC-9).
 */
const PROJECTION_LAYER = new Set([
	"event-log.ts",
	"json-pointer.ts",
	"projector.ts",
	"todo-view.ts",
]);

/** Modules the projection layer must never import: automation, delivery, ingress, wiring. */
const AUTOMATION_TARGETS = new Set([
	"automator.ts",
	"command-queue.ts",
	"dispatcher.ts",
	"event-ingress.ts",
	"event-ingress-tool.ts",
	"index.ts",
	"runtime.ts",
]);

/** Automation and delivery layer: consumes projections, never interprets events (SPEC §9, §10, AC-9). */
const AUTOMATION_LAYER = new Set([
	"automator.ts",
	"command-queue.ts",
	"dispatcher.ts",
]);

/** Event-source modules the automation layer must never read or interpret events through. */
const EVENT_SOURCES = new Set([
	"event-ingress.ts",
	"event-ingress-tool.ts",
	"event-log.ts",
	"index.ts",
]);

/** SPEC §2 non-goal domains; their identifiers must not appear in production logic (AC-25). */
const FORBIDDEN_LOGIC_PATTERN =
	/\b(ooda|panopticon|coas|agent_send|mailbox|intersession|crosssession)\b/i;

interface ExtensionSource {
	readonly file: string;
	readonly content: string;
}

function extensionSources(): ExtensionSource[] {
	return listTsFiles(EXTENSION)
		.filter((file) => !file.includes("/tests/"))
		.map((file) => ({
			file: relative(EXTENSION, file),
			content: readFileSync(file, "utf8"),
		}))
		.filter((source) => source.file.endsWith(".ts"));
}

function importsFromLayer(
	source: ExtensionSource,
	layer: ReadonlySet<string>,
): string[] {
	const hits: string[] = [];
	for (const specifier of localImportSpecifiers(source.content)) {
		const moduleName = specifier.split("/").pop() ?? "";
		if (layer.has(moduleName)) {
			hits.push(specifier);
		}
	}
	return hits;
}

describe("pi-event-loop layer boundaries (AC-9)", () => {
	it("keeps projections free of automation imports", () => {
		const violations: string[] = [];
		for (const source of extensionSources()) {
			if (!PROJECTION_LAYER.has(source.file)) {
				continue;
			}
			for (const specifier of importsFromLayer(source, AUTOMATION_TARGETS)) {
				violations.push(`${source.file} -> ${specifier}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it("keeps automation from interpreting events", () => {
		const violations: string[] = [];
		for (const source of extensionSources()) {
			if (!AUTOMATION_LAYER.has(source.file)) {
				continue;
			}
			for (const specifier of importsFromLayer(source, EVENT_SOURCES)) {
				violations.push(`${source.file} -> ${specifier}`);
			}
		}
		expect(violations).toEqual([]);
	});
});

describe("pi-event-loop host configuration boundary", () => {
	it("uses the host CONFIG_DIR_NAME instead of process.cwd or an invented context field", () => {
		const entry = extensionSources().find((source) => source.file === "index.ts");
		expect(entry?.content).toContain("CONFIG_DIR_NAME");
		expect(entry?.content).not.toContain("process.cwd()");
		expect(entry?.content).not.toMatch(/currentCtx[\s\S]{0,80}configDir/);
	});
});

describe("pi-event-loop isolation (SPEC §2, AC-24, AC-25)", () => {
	it("imports only intra-extension, shared lib, node builtins and the pi host API (AC-24)", () => {
		const allowedBareImports = new Set([
			"@earendil-works/pi-coding-agent",
			"@sinclair/typebox",
		]);
		const violations: string[] = [];
		for (const source of extensionSources()) {
			for (const specifier of localImportSpecifiers(source.content)) {
				if (specifier.startsWith("./")) {
					continue;
				}
				const sharedLib = /^(\.\.\/)+lib\//.test(specifier);
				const bareAllowed =
					!specifier.startsWith(".") &&
					(specifier.startsWith("node:") || allowedBareImports.has(specifier));
				if (!sharedLib && !bareAllowed) {
					violations.push(`${source.file}: ${specifier}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("contains no OODA, Panopticon, CoAS or cross-session logic (AC-25)", () => {
		const violations: string[] = [];
		for (const source of extensionSources()) {
			if (FORBIDDEN_LOGIC_PATTERN.test(source.content)) {
				violations.push(source.file);
			}
		}
		expect(violations).toEqual([]);
	});
});

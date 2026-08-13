import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import piDoctorExtension from "../extensions/pi-doctor/index.js";

const EXTENSIONS = ["pi-bionic", "pi-coas", "pi-doctor", "pi-goal", "pi-file-watch", "pi-kanban", "pi-matrix", "pi-ollama-models", "pi-panopticon"];
const tempDirs: string[] = [];

interface DoctorToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

interface DoctorTool {
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		onUpdate: undefined,
		ctx: { cwd: string },
	) => Promise<DoctorToolResult>;
}

interface DoctorCommand {
	handler: (args: string, ctx: {
		cwd: string;
		ui: { notify: (message: string, level: "info" | "warning") => void };
	}) => Promise<void>;
}

async function makeWorkspace(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-doctor-read-only-"));
	tempDirs.push(cwd);
	mkdirSync(join(cwd, "extensions"));
	writeFileSync(join(cwd, "package.json"), JSON.stringify({
		scripts: {
			"check:namespace": "node scripts/check-namespace.mjs",
			typecheck: "tsc --noEmit",
			lint: "biome lint extensions/ lib/ tests/",
			knip: "knip",
			"type-coverage": "type-coverage --strict --at-least 95",
			check: "npm run typecheck",
			test: "vitest run",
		},
		dependencies: { "@sinclair/typebox": "*" },
		devDependencies: { "@earendil-works/pi-coding-agent": "*", typescript: "*", vitest: "*" },
	}));
	for (const extension of EXTENSIONS) {
		const dir = join(cwd, "extensions", extension);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: extension, type: "module", main: "index.ts", pi: { extensions: ["./index.ts"] } }));
		writeFileSync(join(dir, "index.ts"), "export default function extension() {}\n");
	}
	return cwd;
}

function captureDoctorSurfaces(): { tool: DoctorTool; command: DoctorCommand } {
	let tool: DoctorTool | undefined;
	let command: DoctorCommand | undefined;
	const api = {
		registerTool(definition: DoctorTool) {
			tool = definition;
		},
		registerCommand(_name: string, definition: DoctorCommand) {
			command = definition;
		},
	};
	piDoctorExtension(api as unknown as ExtensionAPI);
	if (!tool || !command) {
		throw new Error("pi-doctor surfaces were not registered");
	}
	return { tool, command };
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("pi-doctor read-only contract", () => {
	it("ignores command-like extra tool parameters", async () => {
		const cwd = await makeWorkspace();
		const marker = join(cwd, "tool-command-ran");
		const { tool } = captureDoctorSurfaces();

		const result = await tool.execute("id", {
			includeFindings: true,
			gateCommand: `touch "${marker}"`,
		}, new AbortController().signal, undefined, { cwd });

		expect(existsSync(marker)).toBe(false);
		expect(result.content[0]?.text).toContain("Deprecated gateCommand was ignored");
		expect(result.details.deprecatedGateCommandIgnored).toBe(true);
	});

	it("does not parse or execute a --gate slash-command argument", async () => {
		const cwd = await makeWorkspace();
		const marker = join(cwd, "slash-command-ran");
		const { command } = captureDoctorSurfaces();
		let notification = "";

		await command.handler(`--gate 'touch "${marker}"'`, {
			cwd,
			ui: {
				notify(message) {
					notification = message;
				},
			},
		});

		expect(existsSync(marker)).toBe(false);
		expect(notification).toContain("Deprecated /pi-doctor --gate input was ignored");
		expect(notification).toContain("pi-doctor PASS");
	});
});

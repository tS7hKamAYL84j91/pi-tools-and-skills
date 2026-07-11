import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDoctorReport, runDoctor } from "../extensions/pi-doctor/doctor.js";

const EXTENSIONS = ["pi-bionic", "pi-coas", "pi-doctor", "pi-goal", "pi-file-watch", "pi-kanban", "pi-matrix", "pi-ollama-models", "pi-panopticon"];
let tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-doctor-"));
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

afterEach(async () => {
	for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("runDoctor", () => {
	it("passes a minimal valid pi-tools workspace", async () => {
		const cwd = await makeWorkspace();
		const report = runDoctor(cwd);

		expect(report.ok).toBe(true);
		expect(report.summary.errors).toBe(0);
		expect(formatDoctorReport(report)).toContain("pi-doctor PASS");
	});

	it("reports missing manifests and command namespace collisions", async () => {
		const cwd = await makeWorkspace();
		writeFileSync(join(cwd, "extensions", "pi-doctor", "package.json"), JSON.stringify({ name: "wrong", type: "commonjs" }));
		writeFileSync(join(cwd, "extensions", "pi-doctor", "index.ts"), "pi.registerCommand(\"reload\", {});\npi.registerCommand(\"shared\", {});\npi.registerTool({ name: \"shared_tool\" });\n");
		writeFileSync(join(cwd, "extensions", "pi-bionic", "index.ts"), "pi.registerCommand(\"shared\", {});\npi.registerTool({ name: \"shared_tool\" });\n");

		const report = runDoctor(cwd);
		const text = formatDoctorReport(report);

		expect(report.ok).toBe(false);
		expect(text).toContain("pi-doctor FAIL");
		expect(text).toContain("manifest name must be pi-doctor");
		expect(text).toContain("/reload collides");
		expect(text).toContain("/shared is registered by both");
		expect(text).toContain("shared_tool tool is registered by both");
	});
});

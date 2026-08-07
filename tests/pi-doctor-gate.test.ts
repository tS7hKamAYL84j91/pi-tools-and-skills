import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDoctorReport, runDoctor } from "../extensions/pi-doctor/doctor.js";

const EXTENSIONS = ["pi-bionic", "pi-coas", "pi-doctor", "pi-goal", "pi-file-watch", "pi-kanban", "pi-matrix", "pi-ollama-models", "pi-panopticon"];
let tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-doctor-gate-"));
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

describe("runDoctor gate command", () => {
	it("reports PASS when gate exits 0", async () => {
		const cwd = await makeWorkspace();
		const report = await runDoctor(cwd, "exit 0");
		const text = formatDoctorReport(report);

		expect(report.ok).toBe(true);
		expect(text).toContain("Gate command passed");
		expect(text).toContain("pi-doctor PASS");
	});

	it("reports FAIL when gate exits non-zero", async () => {
		const cwd = await makeWorkspace();
		const report = await runDoctor(cwd, "echo 'gate failed' >&2; exit 1");
		const text = formatDoctorReport(report);

		expect(report.ok).toBe(false);
		expect(text).toContain("gate failed");
		expect(text).toContain("pi-doctor FAIL");
	});

	it("remains backward-compatible without gate", async () => {
		const cwd = await makeWorkspace();
		const report = await runDoctor(cwd);

		expect(report.ok).toBe(true);
		expect(report.summary.errors).toBe(0);
	});
});

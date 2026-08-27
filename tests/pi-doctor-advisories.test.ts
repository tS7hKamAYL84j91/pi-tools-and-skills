/**
 * Regression tests for pi-doctor supply-chain advisory checking (T-837).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	SUPPLY_CHAIN_ADVISORIES,
	advisoriesForDependencies,
	isKnownAdvisoryId,
} from "../extensions/pi-doctor/advisories.js";
import { dismissAdvisory, formatDoctorReport, readDismissedAdvisories, runDoctor } from "../extensions/pi-doctor/doctor.js";

const EXTENSIONS = ["pi-bionic", "pi-coas", "pi-doctor", "pi-goal", "pi-file-watch", "pi-kanban", "pi-matrix", "pi-ollama-models", "pi-panopticon"];

const PINNED_RANGE_ID = "SCA-NPM-2025-09-08-CHALK";
const WORM_ID = "SCA-NPM-2025-SHAI-HULUD-TINYCOLOR";

const tempDirs: string[] = [];

async function makeWorkspace(dependencies: Record<string, string> = {}): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-doctor-advisory-"));
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
		dependencies: { "@sinclair/typebox": "*", ...dependencies },
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
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("supply-chain advisory matching", () => {
	it("flags a dependency whose version matches a known-compromised release", () => {
		const matches = advisoriesForDependencies({ chalk: "^5.6.0" }, new Set());
		expect(matches.map((advisory) => advisory.id)).toContain(PINNED_RANGE_ID);
	});

	it("does not flag a dependency outside the compromised range", () => {
		const matches = advisoriesForDependencies({ chalk: "^5.5.0" }, new Set());
		expect(matches).toHaveLength(0);
	});

	it("flags any version when the advisory lists no compromised range", () => {
		const matches = advisoriesForDependencies({ "@ctrl/tinycolor": "4.1.0" }, new Set());
		expect(matches.map((advisory) => advisory.id)).toContain(WORM_ID);
	});

	it("excludes dismissed advisory ids", () => {
		const matches = advisoriesForDependencies({ chalk: "5.6.0" }, new Set([PINNED_RANGE_ID]));
		expect(matches).toHaveLength(0);
	});
});

describe("runDoctor supply-chain integration", () => {
	it("reports a matching advisory as a warning with the stable id, without failing the report", async () => {
		const cwd = await makeWorkspace({ chalk: "5.6.0" });
		const report = await runDoctor(cwd);
		const text = formatDoctorReport(report);
		expect(text).toContain(PINNED_RANGE_ID);
		expect(text).toContain("supply-chain");
		expect(report.ok).toBe(true);
		expect(report.summary.warnings).toBeGreaterThan(0);
	});

	it("does not report advisories for a clean workspace", async () => {
		const cwd = await makeWorkspace();
		const report = await runDoctor(cwd);
		expect(formatDoctorReport(report)).not.toContain("supply-chain");
	});

	it("suppresses the advisory once dismissed", async () => {
		const cwd = await makeWorkspace({ chalk: "5.6.0" });
		await dismissAdvisory(cwd, PINNED_RANGE_ID);
		const dismissed = await readDismissedAdvisories(cwd);
		const report = await runDoctor(cwd, dismissed);
		expect(formatDoctorReport(report)).not.toContain(PINNED_RANGE_ID);
		expect(report.ok).toBe(true);
	});
});

describe("advisory dismissal", () => {
	it("persists dismissals and rejects unknown ids", async () => {
		const cwd = await makeWorkspace();
		await dismissAdvisory(cwd, PINNED_RANGE_ID);
		expect(await readDismissedAdvisories(cwd)).toEqual(new Set([PINNED_RANGE_ID]));
		await expect(dismissAdvisory(cwd, "SCA-DOES-NOT-EXIST")).rejects.toThrow("Unknown advisory id");
	});

	it("validates catalog ids", () => {
		expect(isKnownAdvisoryId(PINNED_RANGE_ID)).toBe(true);
		expect(isKnownAdvisoryId("SCA-NOPE")).toBe(false);
		expect(SUPPLY_CHAIN_ADVISORIES.length).toBeGreaterThan(0);
	});
});
/** Offline packaging/import boundaries and live opt-in denial. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, localImportSpecifiers } from "../architecture/helpers.js";

describe("benchmark isolation", () => {
	it("shipping sources do not import evaluation runners or tests", () => {
		const violations: string[] = [];
		for (const root of ["extensions", "lib", "fleet-mcp", "scripts"]) {
			for (const file of listFiles(root, [".ts", ".mjs", ".js"])) {
				if (/\.(test|spec)\.[cm]?[jt]s$/.test(file)) continue;
				for (const specifier of localImportSpecifiers(readFileSync(file, "utf8"))) {
					const target = relative(process.cwd(), resolve(dirname(file), specifier));
					if (/^(benchmarks|tests)\//.test(target)) violations.push(`${file} -> ${target}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("keeps runners outside the published package and preserves npm entrypoints", () => {
		const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
			files: string[];
			scripts: Record<string, string>;
		};
		expect(manifest.files).not.toContain("benchmarks");
		expect(manifest.files).not.toContain("tests");
		expect(manifest.scripts["benchmark:goal"]).toBe("python3 -B benchmarks/goal-benchmark.py");
		expect(manifest.scripts["benchmark:teams:live"]).toBe("node benchmarks/team-live-benchmark.mjs");
	});

	it("denies the moved Teams CLI before running providers without explicit opt-in", () => {
		const env = { ...process.env };
		delete env.PI_TEAM_LIVE_BENCHMARK;
		const result = spawnSync(process.execPath, ["benchmarks/team-live-benchmark.mjs"], {
			cwd: process.cwd(), env, encoding: "utf8", timeout: 5_000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("PI_TEAM_LIVE_BENCHMARK=1 is required");
	});
});

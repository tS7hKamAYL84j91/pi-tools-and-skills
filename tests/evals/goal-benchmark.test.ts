import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("local Goal benchmark runner", () => {
	it("passes offline fixture and RPC regression tests without model calls", () => {
		// unittest writes its summary to stderr; check both streams explicitly.
		const result = spawnSync("python3", ["-B", "tests/evals/goal_benchmark_test.py"], {
			cwd: process.cwd(),
			encoding: "utf8",
			timeout: 30_000,
		});
		expect(result.error ?? result.status, result.stderr).toBe(0);
		// Guard against a silently empty suite: unittest exits 0 with zero tests.
		const ran = result.stderr.match(/^Ran (\d+) tests?\b/m);
		expect(Number(ran?.[1]), result.stderr).toBeGreaterThan(0);
		expect(result.stderr.trimEnd().endsWith("OK"), result.stderr).toBe(true);
	});
});
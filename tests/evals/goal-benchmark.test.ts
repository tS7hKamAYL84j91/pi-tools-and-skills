import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The Python suite includes bounded fake-RPC shutdown waits. Keep Vitest's
// deadline beyond the subprocess deadline, not its default five seconds.
const OFFLINE_SUITE_TIMEOUT_MS = 30_000;

describe("local Goal benchmark runner", () => {
	it("passes offline fixture and RPC regression tests without model calls", () => {
		// unittest writes its summary to stderr; check both streams explicitly.
		const result = spawnSync("python3", ["-B", "tests/evals/goal_benchmark_test.py"], {
			cwd: process.cwd(),
			encoding: "utf8",
			timeout: OFFLINE_SUITE_TIMEOUT_MS,
		});
		expect(result.error ?? result.status, result.stderr).toBe(0);
		// Guard against a silently empty suite: unittest exits 0 with zero tests.
		const ran = result.stderr.match(/^Ran (\d+) tests?\b/m);
		expect(Number(ran?.[1]), result.stderr).toBeGreaterThan(0);
		expect(result.stderr.trimEnd().endsWith("OK"), result.stderr).toBe(true);
	}, OFFLINE_SUITE_TIMEOUT_MS + 5_000);
});

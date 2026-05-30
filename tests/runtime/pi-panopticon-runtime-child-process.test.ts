import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { spawnRuntimeChildProcess } from "../../lib/runtime-child-process.js";

describe("spawnRuntimeChildProcess", () => {
	it("captures successful child process output", async () => {
		const result = await spawnRuntimeChildProcess({
			label: "node stdout smoke test",
			command: execPath,
			args: ["-e", "process.stdout.write('ok\\n')"],
			cwd: process.cwd(),
		});

		expect(result.ok).toBe(true);
		expect(result.stdout.trim()).toBe("ok");
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	});

	it("resolves cancelled runs without throwing", async () => {
		const controller = new AbortController();
		const pending = spawnRuntimeChildProcess({
			label: "node cancellation smoke test",
			command: execPath,
			args: ["-e", "setTimeout(() => process.stdout.write('late\\n'), 1000)"],
			cwd: process.cwd(),
			signal: controller.signal,
		});
		controller.abort();

		const result = await pending;
		expect(result.ok).toBe(false);
		expect(result.error).toBe("cancelled");
	});
});

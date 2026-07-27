/**
 * Cancellation tests for pi-teams subprocess model runner.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

vi.mock("../../lib/spawn-service.js", () => ({
	resolvePiBinary: () => process.env.PI_TEAMS_TEST_PI_BINARY ?? process.execPath,
}));

afterEach(() => {
	vi.useRealTimers();
	delete process.env.PI_TEAMS_TEST_PI_BINARY;
	delete process.env.PI_TEAMS_TEST_TERM_FILE;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("team runner cancellation", () => {
	it("aborts a model-backed child process through AbortSignal", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-teams-cancel-"));
		tempDirs.push(dir);
		const script = join(dir, "fake-pi.js");
		const termFile = join(dir, "term");
		writeFileSync(script, [
			"#!/usr/bin/env node",
			"process.on('SIGTERM', () => { require('node:fs').writeFileSync(process.env.PI_TEAMS_TEST_TERM_FILE, 'TERM'); process.exit(143); });",
			"setTimeout(() => { process.stdout.write('late output\\n'); process.exit(0); }, 10000);",
		].join("\n"), "utf8");
		chmodSync(script, 0o755);
		process.env.PI_TEAMS_TEST_PI_BINARY = script;
		process.env.PI_TEAMS_TEST_TERM_FILE = termFile;
		const { runMember } = await import("../../extensions/pi-panopticon/teams/runner.js");
		const controller = new AbortController();
		const startedAt = Date.now();
		const promise = runMember({ label: "Cancel", model: "test/model" }, {
			prompt: "test prompt",
			systemPrompt: "test system",
			cwd: process.cwd(),
			signal: controller.signal,
		});

		setTimeout(() => controller.abort(), 50);
		const result = await promise;

		expect(result.ok).toBe(false);
		expect(result.error).toBe("cancelled");
		await vi.waitFor(() => expect(readFileSync(termFile, "utf8")).toBe("TERM"));
		expect(Date.now() - startedAt).toBeLessThan(5000);
	});
});

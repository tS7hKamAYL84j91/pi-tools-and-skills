import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { spawnRuntimeChildProcess } from "../../lib/runtime-child-process.js";

const OUTPUT_LIMIT_BYTES = 256 * 1024;

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForFile(path: string): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (!existsSync(path)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for child marker: ${path}`);
		await delay(10);
	}
}

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

	it("writes supplied stdin and closes it while preserving output streams", async () => {
		const result = await spawnRuntimeChildProcess({
			label: "node stdin smoke test",
			command: execPath,
			args: [
				"-e",
				"process.stdin.on('data', chunk => process.stdout.write(chunk)); process.stdin.on('end', () => process.stderr.write('eof\\n'))",
			],
			cwd: process.cwd(),
			stdin: "exact payload\nwith another line",
		});

		expect(result.ok).toBe(true);
		expect(result.stdout).toBe("exact payload\nwith another line");
		expect(result.stderr).toBe("eof\n");
		expect(result.exitCode).toBe(0);
	});

	it("does not spawn a child for a pre-aborted request", async () => {
		const directory = await mkdtemp(join(tmpdir(), "runtime-child-pre-abort-"));
		const marker = join(directory, "spawned");
		const controller = new AbortController();
		controller.abort();
		try {
			const result = await spawnRuntimeChildProcess({
				label: "pre-aborted child",
				command: execPath,
				args: ["-e", "require('node:fs').writeFileSync(process.argv[1], 'spawned')", marker],
				cwd: process.cwd(),
				signal: controller.signal,
			});
			await delay(100);

			expect(result).toMatchObject({ ok: false, exitCode: null, error: "cancelled" });
			expect(existsSync(marker)).toBe(false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("handles an abort immediately after spawn without hanging", async () => {
		const controller = new AbortController();
		const pending = spawnRuntimeChildProcess({
			label: "immediate cancellation",
			command: execPath,
			args: ["-e", "setInterval(() => {}, 1000)"],
			cwd: process.cwd(),
			signal: controller.signal,
		});
		controller.abort();

		await expect(pending).resolves.toMatchObject({ ok: false, exitCode: null, error: "cancelled" });
	});

	it("waits for a TERM-responsive child to close before resolving cancellation", async () => {
		const directory = await mkdtemp(join(tmpdir(), "runtime-child-term-"));
		const marker = join(directory, "ready");
		const controller = new AbortController();
		try {
			const pending = spawnRuntimeChildProcess({
				label: "TERM-responsive child",
				command: execPath,
				args: [
					"-e",
					"const fs = require('node:fs'); process.on('SIGTERM', () => setTimeout(() => { process.stdout.write('term-complete\\n'); process.exit(0); }, 75)); fs.writeFileSync(process.argv[1], 'ready'); setInterval(() => {}, 1000);",
					marker,
				],
				cwd: process.cwd(),
				signal: controller.signal,
			});
			await waitForFile(marker);
			controller.abort();
			const result = await pending;

			expect(result).toMatchObject({ ok: false, exitCode: null, error: "cancelled" });
			expect(result.stdout).toContain("term-complete");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("escalates a TERM-ignoring child to KILL after the grace period", async () => {
		const directory = await mkdtemp(join(tmpdir(), "runtime-child-kill-"));
		const marker = join(directory, "ready");
		const controller = new AbortController();
		try {
			const pending = spawnRuntimeChildProcess({
				label: "TERM-ignoring child",
				command: execPath,
				args: [
					"-e",
					"const fs = require('node:fs'); process.on('SIGTERM', () => process.stderr.write('term-received\\n')); fs.writeFileSync(process.argv[1], 'ready'); setInterval(() => {}, 1000);",
					marker,
				],
				cwd: process.cwd(),
				signal: controller.signal,
			});
			await waitForFile(marker);
			controller.abort();
			const result = await pending;

			expect(result).toMatchObject({ ok: false, exitCode: null, error: "cancelled" });
			expect(result.stderr).toContain("term-received");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 5_000);

	it.skipIf(process.platform === "win32")("keeps escalation alive when the direct child closes before a TERM-ignoring descendant", async () => {
		const directory = await mkdtemp(join(tmpdir(), "runtime-child-tree-"));
		const readyMarker = join(directory, "ready");
		const descendantMarker = join(directory, "descendant-finished");
		const controller = new AbortController();
		try {
			const descendantScript = [
				"const fs = require('node:fs');",
				"process.on('SIGTERM', () => {});",
				"fs.writeFileSync(process.argv[1], String(process.pid));",
				"setTimeout(() => fs.writeFileSync(process.argv[2], 'late'), 700);",
				"setInterval(() => {}, 1000);",
			].join(" ");
			const childScript = [
				"const { spawn } = require('node:child_process');",
				`spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}, process.argv[1], process.argv[2]], { stdio: 'ignore' });`,
				"setInterval(() => {}, 1000);",
			].join(" ");
			const pending = spawnRuntimeChildProcess({
				label: "process tree",
				command: execPath,
				args: ["-e", childScript, readyMarker, descendantMarker],
				cwd: process.cwd(),
				signal: controller.signal,
			});
			await waitForFile(readyMarker);
			controller.abort();
			const early = await Promise.race([
				pending.then(() => "resolved" as const),
				delay(100).then(() => "waiting" as const),
			]);
			expect(early).toBe("waiting");
			await expect(pending).resolves.toMatchObject({ ok: false, error: "cancelled" });
			await delay(800);
			expect(existsSync(descendantMarker)).toBe(false);
		} finally {
			try {
				process.kill(Number(await readFile(readyMarker, "utf8")), "SIGKILL");
			} catch {
				// The runtime should already have terminated the descendant.
			}
			await rm(directory, { recursive: true, force: true });
		}
	}, 5_000);

	it("bounds captured stdout and stderr", async () => {
		const result = await spawnRuntimeChildProcess({
			label: "bounded output child",
			command: execPath,
			args: [
				"-e",
				"const output = 'x'.repeat(512 * 1024); process.stdout.write(output); process.stderr.write(output);",
			],
			cwd: process.cwd(),
		});

		expect(result.ok).toBe(true);
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES);
		expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES);
		expect(result.stdout).toContain("[output truncated]");
		expect(result.stderr).toContain("[output truncated]");
	});
});

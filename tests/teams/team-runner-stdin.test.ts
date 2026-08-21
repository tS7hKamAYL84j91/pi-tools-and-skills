/** Integration tests for stdin delivery to one-shot team model children. */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakePiReport {
	argv: string[];
	stdinLength: number;
	stdinMarker: string;
	eof: boolean;
	lockfileContinue?: string;
	stdinIsTty: boolean;
}

const tempDirs: string[] = [];

vi.mock("../../extensions/pi-panopticon/spawner/spawn-service.js", () => ({
	resolvePiBinary: () => process.env.PI_TEAMS_TEST_PI_BINARY ?? process.execPath,
}));

afterEach(() => {
	delete process.env.PI_TEAMS_TEST_PI_BINARY;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createFakePi(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-teams-stdin-"));
	tempDirs.push(dir);
	const script = join(dir, "fake-pi.js");
	writeFileSync(script, [
		"#!/usr/bin/env node",
		"let stdin = '';",
		"process.stdin.setEncoding('utf8');",
		"process.stdin.on('data', (chunk) => { stdin += chunk; });",
		"process.stdin.on('end', () => {",
		"  process.stdout.write(JSON.stringify({",
		"    argv: process.argv.slice(2),",
		"    stdinLength: stdin.length,",
		"    stdinMarker: stdin.slice(0, 16) + '|' + stdin.slice(-16),",
		"    eof: true,",
		"    lockfileContinue: process.env.COAS_PI_LOCKFILE_CONTINUE,",
		"    stdinIsTty: process.stdin.isTTY === true,",
		"  }));",
		"});",
	].join("\n"), "utf8");
	chmodSync(script, 0o755);
	return script;
}

function expectedMarker(prompt: string): string {
	return `${prompt.slice(0, 16)}|${prompt.slice(-16)}`;
}

async function runFakePi(prompt: string): Promise<FakePiReport> {
	process.env.PI_TEAMS_TEST_PI_BINARY = createFakePi();
	const { runMember } = await import("../../extensions/pi-panopticon/teams/runner.js");
	const result = await runMember({ label: "Stdin", model: "test/model" }, {
		prompt,
		systemPrompt: "test system prompt",
		cwd: process.cwd(),
	});

	expect(result.ok).toBe(true);
	return JSON.parse(result.output) as FakePiReport;
}

function restoreTty(descriptor: PropertyDescriptor | undefined): void {
	if (descriptor === undefined) {
		delete (process.stdin as { isTTY?: boolean }).isTTY;
		return;
	}
	Object.defineProperty(process.stdin, "isTTY", descriptor);
}

describe("team runner stdin delivery", () => {
	it("sends a short prompt through stdin, omits it from argv, and closes stdin", async () => {
		const prompt = "short prompt\nwith a second line";
		const report = await runFakePi(prompt);

		expect(report.argv).not.toContain(prompt);
		expect(report.stdinLength).toBe(prompt.length);
		expect(report.stdinMarker).toBe(expectedMarker(prompt));
		expect(report.eof).toBe(true);
		expect(report.lockfileContinue).toBe("1");
	});

	it("delivers a 16,000-character prompt via a pipe from a TTY-like parent", async () => {
		const originalTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
		const prompt = "0123456789".repeat(1600);
		try {
			const report = await runFakePi(prompt);

			expect(prompt.length).toBeGreaterThanOrEqual(16000);
			expect(report.argv).not.toContain(prompt);
			expect(report.stdinLength).toBe(prompt.length);
			expect(report.stdinMarker).toBe(expectedMarker(prompt));
			expect(report.eof).toBe(true);
			expect(report.stdinIsTty).toBe(false);
			expect(report.lockfileContinue).toBe("1");
		} finally {
			restoreTty(originalTty);
		}
	});
});

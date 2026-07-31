/** Regression tests for fork_turns parent-context carry into team runner stdin. */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakePiReport {
	argv: string[];
	stdinLength: number;
	stdin: string;
	eof: boolean;
	lockfileContinue?: string;
}

const tempDirs: string[] = [];

vi.mock("../../lib/spawn-service.js", () => ({
	resolvePiBinary: () => process.env.PI_TEAMS_TEST_PI_BINARY ?? process.execPath,
}));

afterEach(() => {
	delete process.env.PI_TEAMS_TEST_PI_BINARY;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createFakePi(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-teams-fork-turns-"));
	tempDirs.push(dir);
	const script = join(dir, "fake-pi.js");
	writeFileSync(
		script,
		[
			"#!/usr/bin/env node",
			"let stdin = '';",
			"process.stdin.setEncoding('utf8');",
			"process.stdin.on('data', (chunk) => { stdin += chunk; });",
			"process.stdin.on('end', () => {",
			"  process.stdout.write(JSON.stringify({",
			"    argv: process.argv.slice(2),",
			"    stdinLength: stdin.length,",
			"    stdin,",
			"    eof: true,",
			"    lockfileContinue: process.env.COAS_PI_LOCKFILE_CONTINUE,",
			"  }));",
			"});",
		].join("\n"),
		"utf8",
	);
	chmodSync(script, 0o755);
	return script;
}

async function runFakePi(
	prompt: string,
	forkTurns?: import("../../extensions/pi-panopticon/teams/types.js").ForkTurnsMode,
): Promise<FakePiReport> {
	process.env.PI_TEAMS_TEST_PI_BINARY = createFakePi();
	const { runMember } = await import("../../extensions/pi-panopticon/teams/runner.js");
	const result = await runMember(
		{ label: "Fork", model: "test/model" },
		{
			prompt,
			systemPrompt: "test system prompt",
			cwd: process.cwd(),
			forkTurns,
		},
	);

	expect(result.ok).toBe(true);
	return JSON.parse(result.output) as FakePiReport;
}

describe("team runner fork_turns", () => {
	it("default mode leaves stdin unchanged", async () => {
		const prompt = "do the thing";
		const report = await runFakePi(prompt);

		expect(report.stdin).toBe(prompt);
		expect(report.stdinLength).toBe(prompt.length);
	});

	it("explicit none mode leaves stdin unchanged", async () => {
		const prompt = "do the thing";
		const report = await runFakePi(prompt, { mode: "none" });

		expect(report.stdin).toBe(prompt);
		expect(report.argv).not.toContain(prompt);
	});

	it("summary mode injects bounded summary before the task prompt", async () => {
		const prompt = "do the thing";
		const summary = "Parent already decided X.";
		const report = await runFakePi(prompt, { mode: "summary", summary });

		expect(report.stdin.startsWith("Parent context (summary):")).toBe(true);
		expect(report.stdin).toContain(summary);
		expect(report.stdin).toContain("---");
		expect(report.stdin.endsWith(prompt)).toBe(true);
	});

	it("lastN mode injects the last N parent turns before the task prompt", async () => {
		const prompt = "continue";
		const turns = [
			{ role: "user", content: "start" },
			{ role: "assistant", content: "ok" },
			{ role: "user", content: "middle" },
			{ role: "assistant", content: [{ type: "text", text: "working" }] },
		];
		const report = await runFakePi(prompt, { mode: "lastN", turns, n: 2 });

		expect(report.stdin.startsWith("Parent context (last 2 turns):")).toBe(true);
		expect(report.stdin).toContain("[user] middle");
		expect(report.stdin).toContain("[assistant] working");
		expect(report.stdin).not.toContain("start");
		expect(report.stdin).toContain("---");
		expect(report.stdin.endsWith(prompt)).toBe(true);
	});

	it("lastN mode keeps injected block size constant when total turns grow", async () => {
		const prompt = "continue";
		const n = 2;
		const shortTurns = [
			{ role: "user", content: "a" },
			{ role: "assistant", content: "b" },
		];
		const longTurns = [
			{ role: "user", content: "early-1" },
			{ role: "assistant", content: "early-2" },
			{ role: "user", content: "early-3" },
			{ role: "assistant", content: "early-4" },
			{ role: "user", content: "a" },
			{ role: "assistant", content: "b" },
		];

		const shortReport = await runFakePi(prompt, { mode: "lastN", turns: shortTurns, n });
		const longReport = await runFakePi(prompt, { mode: "lastN", turns: longTurns, n });

		expect(shortReport.stdin.length).toBe(longReport.stdin.length);
	});

	it("summary mode keeps injected block size constant across repeated runs", async () => {
		const prompt = "continue";
		const summary = "Constant summary.";
		const first = await runFakePi(prompt, { mode: "summary", summary });
		const second = await runFakePi(prompt, { mode: "summary", summary });

		expect(first.stdin.length).toBe(second.stdin.length);
	});
});

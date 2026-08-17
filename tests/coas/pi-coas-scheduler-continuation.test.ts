/**
 * Regression tests for pi-coas resumable schedule continuation.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";

interface SentPrompt {
	message: string;
	options?: unknown;
}

async function writeSchedule(coasHome: string, taskId: string, workspaceId: string, continuation = false): Promise<void> {
	const schedulesDir = join(coasHome, "schedules");
	const promptPath = join(schedulesDir, `${taskId}.prompt`);
	await mkdir(schedulesDir, { recursive: true });
	await writeFile(promptPath, "Review pending items.\n", "utf8");
	const lines = [
		`TASK_ID=${taskId}`,
		`TASK_NAME=${taskId}`,
		"ROOM_ID=general",
		`WORKSPACE_ID=${workspaceId}`,
		"CRON_EXPR=0 9 * * 1",
		`PROMPT_FILE=${promptPath}`,
		"ENABLED=1",
	];
	if (continuation) lines.push("CONTINUATION=1");
	lines.push("");
	await writeFile(join(schedulesDir, `${taskId}.env`), lines.join("\n"));
}

function makePi(sessionName?: string): { sendUserMessage: (message: string, options?: unknown) => void; getSessionName: () => string | undefined; sent: SentPrompt[] } {
	const sent: SentPrompt[] = [];
	return {
		sendUserMessage(message: string, options?: unknown) {
			sent.push({ message, options });
		},
		getSessionName() {
			return sessionName;
		},
		get sent() {
			return sent;
		},
	};
}

function assistantMessage(text: string): { role: string; content: string } {
	return { role: "assistant", content: text };
}

function userMessage(text: string): { role: string; content: string } {
	return { role: "user", content: text };
}

const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

describe("CoasInternalScheduler continuation", () => {
	const previousEnv: Record<string, string | undefined> = {
		[COAS_WORKSPACE_ID_ENV]: process.env[COAS_WORKSPACE_ID_ENV],
		[PANOPTICON_SCOPE_ENV]: process.env[PANOPTICON_SCOPE_ENV],
		[PANOPTICON_SPAWN_NAME_ENV]: process.env[PANOPTICON_SPAWN_NAME_ENV],
	};

	beforeEach(() => {
		delete process.env[COAS_WORKSPACE_ID_ENV];
		delete process.env[PANOPTICON_SCOPE_ENV];
		delete process.env[PANOPTICON_SPAWN_NAME_ENV];
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it("carries prior-run summary across two consecutive triggers", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-cont-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });

			// First trigger: no prior summary yet.
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(pi.sent[0]?.message).not.toContain("Prior run");

			// Simulate the agent completing the scheduled turn.
			const firstPrompt = pi.sent[0]?.message ?? "";
			await scheduler.handleAgentEnd([userMessage(firstPrompt), assistantMessage("DONE: reviewed 3 PRs. NEXT: check dependencies.")]);

			// Second trigger one week later: prior summary injected.
			await scheduler.tick(new Date("2026-01-12T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(2);
			expect(pi.sent[1]?.message).toContain("Prior run");
			expect(pi.sent[1]?.message).toContain("reviewed 3 PRs");
			expect(pi.sent[1]?.message).toContain("check dependencies");
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("does not inject phantom summary when no completed run exists", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-no-prior-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(pi.sent[0]?.message).not.toContain("Prior run");
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("keeps only one run-state file per task after multiple triggers", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-shape-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });

			for (let i = 0; i < 3; i++) {
				const day = 5 + i * 7;
				await scheduler.tick(new Date(`2026-01-${day.toString().padStart(2, "0")}T09:00:00`));
				await scheduler.flush();
				if (i > 0) {
					const prompt = pi.sent.at(-1)?.message ?? "";
					await scheduler.handleAgentEnd([userMessage(prompt), assistantMessage(`DONE: cycle ${i}. NEXT: more work.`)]);
				} else {
					const prompt = pi.sent.at(-1)?.message ?? "";
					await scheduler.handleAgentEnd([userMessage(prompt), assistantMessage("DONE: cycle 0. NEXT: more work.")]);
				}
			}

			const runStatePath = join(coasHome, "schedule-runs", "daily.json");
			expect(existsSync(runStatePath)).toBe(true);
			const raw = await readFile(runStatePath, "utf8");
			const state = JSON.parse(raw) as { runs?: unknown[] };
			expect(state.runs).toBeUndefined();
			expect(raw).toContain("cycle 2");
			expect(raw).not.toContain("cycle 0");
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("keeps injected continuation summary length constant across repeated triggers", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-bloat-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });

			const priorBlockLengths: number[] = [];
			for (let i = 0; i < 5; i++) {
				const day = 5 + i * 7;
				await scheduler.tick(new Date(`2026-01-${day.toString().padStart(2, "0")}T09:00:00`));
				await scheduler.flush();
				const message = pi.sent.at(-1)?.message ?? "";
				const priorStart = message.indexOf("Prior run");
				const priorBlock = priorStart >= 0 ? message.slice(priorStart, message.indexOf("---", priorStart)) : "";
				priorBlockLengths.push(priorBlock.length);

				await scheduler.handleAgentEnd([userMessage(message), assistantMessage("DONE: work done. NEXT: more work.")]);
			}

			// First trigger had no prior block; others should be similar length.
			const nonZero = priorBlockLengths.slice(1);
			expect(nonZero.length).toBeGreaterThan(0);
			const first = nonZero[0] ?? 0;
			for (const length of nonZero) {
				expect(Math.abs(length - first)).toBeLessThanOrEqual(10);
			}
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("does not inject stale prior-run summary", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-stale-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await mkdir(join(coasHome, "schedule-runs"), { recursive: true });
			await writeFile(
				join(coasHome, "schedule-runs", "daily.json"),
				JSON.stringify({
					taskId: "daily",
					runId: "run-old",
					status: "complete",
					startedAt: "2026-01-05T09:00:00Z",
					completedAt: "2026-01-05T09:05:00Z",
					summary: "old work",
					nextAction: "none",
					lastUpdatedAt: "2026-01-05T09:05:00Z",
				}),
			);
			await scheduler.reconcile({ coasHome });

			await scheduler.tick(new Date("2026-01-19T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(pi.sent[0]?.message).toContain("may be stale");
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("persists active runs as interrupted before stop resets scheduler state", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-stop-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			const runStatePath = join(coasHome, "schedule-runs", "daily.json");
			expect(JSON.parse(await readFile(runStatePath, "utf8"))).toMatchObject({ status: "running" });

			await scheduler.stop();

			expect(JSON.parse(await readFile(runStatePath, "utf8"))).toMatchObject({
				status: "interrupted",
				summary: "Run interrupted: session_shutdown",
			});
			expect(scheduler.snapshot()).toMatchObject({ running: false, enabledSchedules: 0, activeRuns: 0 });
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("does not inject interrupted run summary", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-interrupt-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });

			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			const prompt = pi.sent[0]?.message ?? "";
			await scheduler.handleAgentEnd([userMessage(prompt), { role: "assistant", content: "Oops.", stopReason: "error", errorMessage: "model error" }]);

			await scheduler.tick(new Date("2026-01-12T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(2);
			expect(pi.sent[1]?.message).not.toContain("Prior run");
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("non-continuation schedules remain stateless", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-stateless-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", false);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			const prompt = pi.sent[0]?.message ?? "";
			await scheduler.handleAgentEnd([userMessage(prompt), assistantMessage("DONE: work.")]);

			expect(existsSync(join(coasHome, "schedule-runs", "daily.json"))).toBe(false);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("removeSchedule deletes run-state file", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-remove-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			const prompt = pi.sent[0]?.message ?? "";
			await scheduler.handleAgentEnd([userMessage(prompt), assistantMessage("DONE: work.")]);

			const { removeSchedule } = await import("../../extensions/pi-coas/schedules.js");
			await removeSchedule({ coasHome }, "daily");
			expect(existsSync(join(coasHome, "schedule-runs", "daily.json"))).toBe(false);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("still drops continuation schedule on workspace mismatch", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "wrong-workspace";
		const coasHome = join(tmpdir(), `pi-coas-cont-guard-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", true);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(0);
			expect(scheduler.snapshot().droppedScheduleRuns).toBe(1);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});
});

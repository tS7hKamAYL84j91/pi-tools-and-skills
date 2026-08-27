/**
 * Regression tests for the pi-coas quota-aware should-run gate.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";
import { parkApproval } from "../../extensions/pi-coas/approval-inbox.js";
import { appendRunHistory, type ScheduleRunHistoryEntry } from "../../extensions/pi-coas/scheduler-run-state.js";
import { isoUtc } from "../../extensions/pi-coas/store-paths.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

interface SentPrompt {
	message: string;
	options?: unknown;
}

async function writeSchedule(
	coasHome: string,
	taskId: string,
	workspaceId: string,
	{ continuation = false, runBudget, lookback }: { continuation?: boolean; runBudget?: number; lookback?: number } = {},
): Promise<void> {
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
	if (runBudget !== undefined) lines.push(`RUN_BUDGET=${runBudget}`);
	if (lookback !== undefined) lines.push(`LOOKBACK=${lookback}`);
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

async function seedHistory(
	coasHome: string,
	taskId: string,
	outcome: ScheduleRunHistoryEntry["outcome"],
	count: number,
): Promise<void> {
	for (let i = 0; i < count; i++) {
		await appendRunHistory({ coasHome }, taskId, {
			runId: `seed-${i}`,
			startedAt: isoUtc(new Date(`2026-01-0${i + 1}T09:00:00Z`)),
			outcome,
		});
	}
}

describe("CoasInternalScheduler should-run quota gate", () => {
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

	it("queues a schedule with no history", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-sr-pass-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(scheduler.snapshot().queued).toBe(1);
			expect(scheduler.snapshot().skippedRuns).toBe(0);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("skips when the last N runs produced the same skipped outcome", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-sr-dim-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", { lookback: 3 });
			await seedHistory(coasHome, "daily", "skipped-diminishing", 3);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(0);
			expect(scheduler.snapshot().skippedRuns).toBe(1);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("skips while a prior approval request is pending", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-sr-appr-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant");
			await mkdir(join(coasHome, "schedule-runs", "awaiting-approval"), { recursive: true });
			await parkApproval({
				config: { coasHome },
				taskId: "daily",
				runId: "run-pending",
				prompt: "Send a message to the team.",
				requestId: "daily-run-pending",
			});
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(0);
			expect(scheduler.snapshot().skippedRuns).toBe(1);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("skips when the run budget is exhausted", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-sr-budget-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", { runBudget: 2 });
			await seedHistory(coasHome, "daily", "queued", 2);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(0);
			expect(scheduler.snapshot().skippedRuns).toBe(1);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("queues again once the blocker is cleared", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-sr-recover-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", { lookback: 3 });
			await seedHistory(coasHome, "daily", "skipped-diminishing", 2);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(scheduler.snapshot().skippedRuns).toBe(0);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});
});

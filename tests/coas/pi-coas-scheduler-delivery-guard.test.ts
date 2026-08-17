import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";

const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

async function writeSchedule(coasHome: string, taskId: string, workspaceId: string, targetAgent?: string): Promise<void> {
	const schedulesDir = join(coasHome, "schedules");
	const promptPath = join(schedulesDir, `${taskId}.prompt`);
	await mkdir(schedulesDir, { recursive: true });
	await writeFile(promptPath, "Do work.\n", "utf8");
	const lines = [
		`TASK_ID=${taskId}`,
		`TASK_NAME=${taskId}`,
		"ROOM_ID=general",
		`WORKSPACE_ID=${workspaceId}`,
		"CRON_EXPR=0 9 * * 1",
		`PROMPT_FILE=${promptPath}`,
		"ENABLED=1",
	];
	if (targetAgent) lines.push(`TARGET_AGENT=${targetAgent}`);
	lines.push("");
	await writeFile(join(schedulesDir, `${taskId}.env`), lines.join("\n"));
}

function makePi(sessionName?: string): { sendUserMessage: () => void; getSessionName: () => string | undefined; sent: number } {
	let sent = 0;
	return {
		sendUserMessage() {
			sent++;
		},
		getSessionName() {
			return sessionName;
		},
		get sent() {
			return sent;
		},
	};
}

describe("CoasInternalScheduler delivery guard", () => {
	const previousEnv: Record<string, string | undefined> = {
		[PANOPTICON_SCOPE_ENV]: process.env[PANOPTICON_SCOPE_ENV],
		[PANOPTICON_SPAWN_NAME_ENV]: process.env[PANOPTICON_SPAWN_NAME_ENV],
		COAS_WORKSPACE_ID: process.env.COAS_WORKSPACE_ID,
	};

	beforeEach(() => {
		delete process.env[PANOPTICON_SCOPE_ENV];
		delete process.env[PANOPTICON_SPAWN_NAME_ENV];
		delete process.env.COAS_WORKSPACE_ID;
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

	it("delivers workspace schedule to matching root session", async () => {
		process.env.COAS_WORKSPACE_ID = "admin-assistant";
		const coasHome = join(tmpdir(), `pi-coas-dg-match-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent).toBe(1);
			expect(scheduler.snapshot().droppedScheduleRuns).toBe(0);
			expect(scheduler.snapshot().queued).toBe(1);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("drops workspace schedule from task-scoped spawned session", async () => {
		process.env.COAS_WORKSPACE_ID = "admin-assistant";
		process.env[PANOPTICON_SCOPE_ENV] = "task";
		process.env[PANOPTICON_SPAWN_NAME_ENV] = "kaggle-worker";
		const coasHome = join(tmpdir(), `pi-coas-dg-task-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent).toBe(0);
			expect(scheduler.snapshot().droppedScheduleRuns).toBe(1);
			expect(scheduler.snapshot().queued).toBe(0);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("drops workspace schedule when active workspace mismatches", async () => {
		process.env.COAS_WORKSPACE_ID = "pi-tools-and-skills";
		const coasHome = join(tmpdir(), `pi-coas-dg-mismatch-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent).toBe(0);
			expect(scheduler.snapshot().droppedScheduleRuns).toBe(1);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("delivers when targetAgent matches active spawned agent", async () => {
		process.env.COAS_WORKSPACE_ID = "admin-assistant";
		process.env[PANOPTICON_SCOPE_ENV] = "task";
		process.env[PANOPTICON_SPAWN_NAME_ENV] = "authorized-worker";
		const coasHome = join(tmpdir(), `pi-coas-dg-target-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", "authorized-worker");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent).toBe(1);
			expect(scheduler.snapshot().droppedScheduleRuns).toBe(0);
			expect(scheduler.snapshot().queued).toBe(1);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("drops when targetAgent does not match active agent", async () => {
		process.env.COAS_WORKSPACE_ID = "admin-assistant";
		process.env[PANOPTICON_SCOPE_ENV] = "workspace";
		process.env[PANOPTICON_SPAWN_NAME_ENV] = "other-worker";
		const coasHome = join(tmpdir(), `pi-coas-dg-target-mismatch-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		try {
			await writeSchedule(coasHome, "daily", "admin-assistant", "authorized-worker");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent).toBe(0);
			expect(scheduler.snapshot().droppedScheduleRuns).toBe(1);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});
});

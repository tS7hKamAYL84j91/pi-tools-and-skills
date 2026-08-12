/** Test-first regression tests for T-812 spawn-don't-await + run-once-catch-up. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";

interface SentPrompt {
	message: string;
	options?: unknown;
}

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const tempDirs: string[] = [];

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

function writeSchedule(coasHome: string, taskId: string, workspaceId: string, cron: string, approvalRequired = false, continuation = false): void {
	const schedulesDir = join(coasHome, "schedules");
	const promptPath = join(schedulesDir, `${taskId}.prompt`);
	mkdirSync(schedulesDir, { recursive: true });
	writeFileSync(promptPath, `Run ${taskId}.\n`, "utf8");
	const lines = [
		`TASK_ID=${taskId}`,
		`TASK_NAME=${taskId}`,
		"ROOM_ID=general",
		`WORKSPACE_ID=${workspaceId}`,
		`CRON_EXPR=${cron}`,
		`PROMPT_FILE=${promptPath}`,
		"ENABLED=1",
	];
	if (continuation) lines.push("CONTINUATION=1");
	if (approvalRequired) lines.push("APPROVAL_REQUIRED=1");
	lines.push("");
	writeFileSync(join(schedulesDir, `${taskId}.env`), lines.join("\n"), "utf8");
}

describe.skip("CoasInternalScheduler spawn-don't-await + catchup", () => {
	const previousEnv: Record<string, string | undefined> = {
		[COAS_WORKSPACE_ID_ENV]: process.env[COAS_WORKSPACE_ID_ENV],
		PI_PRINCIPAL: process.env.PI_PRINCIPAL,
	};

	beforeEach(() => {
		delete process.env[COAS_WORKSPACE_ID_ENV];
		delete process.env.PI_PRINCIPAL;
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	function makeCoasHome(): string {
		const dir = `${tmpdir()}/pi-coas-spawn-${process.pid}-${Date.now()}`;
		mkdirSync(dir, { recursive: true });
		tempDirs.push(dir);
		return dir;
	}

	it("a parked approval does not delay a sibling due schedule", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		process.env.PI_PRINCIPAL = "1";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "approval-task", "room-a", "0 9 * * 1", true);
		writeSchedule(coasHome, "sibling-task", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		await (scheduler as { flush?(): Promise<void> }).flush?.();

		expect(pi.sent.length).toBe(2);
		const sentTasks = pi.sent.map((s) => {
			const match = s.message.match(/Run (\S+)\./);
			return match?.[1] ?? "";
		});
		expect(sentTasks).toContain("approval-task");
		expect(sentTasks).toContain("sibling-task");
	});

	it("snapshot reflects spawned runs during in-flight send and zero after flush", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "slow-task", "room-a", "0 9 * * 1");

		let activeDuringSend = 0;
		let spawnedDuringSend = 0;
		const scheduler = new CoasInternalScheduler({
			...pi,
			sendUserMessage(message: string, options?: unknown) {
				activeDuringSend = scheduler.snapshot().activeRuns;
				spawnedDuringSend = (scheduler as { snapshot(): { spawnedRuns?: number } }).snapshot().spawnedRuns ?? 0;
				pi.sendUserMessage(message, options);
			},
		} as never);

		await scheduler.reconcile({ coasHome });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));

		expect(activeDuringSend).toBeGreaterThan(0);
		expect(spawnedDuringSend).toBeGreaterThan(0);

		await (scheduler as { flush?(): Promise<void> }).flush?.();
		const snapshot = scheduler.snapshot();
		expect(snapshot.activeRuns).toBe(0);
		expect((snapshot as { spawnedRuns?: number }).spawnedRuns).toBe(0);
	});

	it("start() catchup fires a missed run immediately", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "catchup-task", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		scheduler.start({ coasHome });
		await (scheduler as { flush?(): Promise<void> }).flush?.();

		expect(pi.sent.length).toBe(1);
		expect(pi.sent[0]?.message).toContain("catchup-task");
		scheduler.stop();
	});

	it("catchup prevents duplicate fire on the first tick", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "once-task", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		await (scheduler as { flush?(): Promise<void> }).flush?.();
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		await (scheduler as { flush?(): Promise<void> }).flush?.();

		expect(pi.sent.length).toBe(1);
	});

	it("spawned run completes after tick returns", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "after-tick", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });

		const tickPromise = scheduler.tick(new Date("2026-01-05T09:00:00"));
		expect(pi.sent.length).toBe(0);
		await tickPromise;
		await (scheduler as { flush?(): Promise<void> }).flush?.();
		expect(pi.sent.length).toBe(1);
	});
});

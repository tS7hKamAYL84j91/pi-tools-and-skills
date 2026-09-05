/** Deterministic tests for ADR-044 spawn-don't-await scheduled runs with startup catchup. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";

interface SentPrompt {
	message: string;
	options?: unknown;
}

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";
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

describe("CoasInternalScheduler spawn-don't-await + catchup", () => {
	const previousEnv: Record<string, string | undefined> = {
		[COAS_WORKSPACE_ID_ENV]: process.env[COAS_WORKSPACE_ID_ENV],
		PI_PRINCIPAL: process.env.PI_PRINCIPAL,
		[PANOPTICON_SCOPE_ENV]: process.env[PANOPTICON_SCOPE_ENV],
		[PANOPTICON_SPAWN_NAME_ENV]: process.env[PANOPTICON_SPAWN_NAME_ENV],
	};

	beforeEach(() => {
		delete process.env[COAS_WORKSPACE_ID_ENV];
		delete process.env.PI_PRINCIPAL;
		delete process.env[PANOPTICON_SCOPE_ENV];
		delete process.env[PANOPTICON_SPAWN_NAME_ENV];
		vi.useFakeTimers();
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
		vi.useRealTimers();
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
		expect(scheduler.snapshot().spawnedRuns).toBeGreaterThan(0);
		await scheduler.flush();

		expect(pi.sent.length).toBe(1);
		expect(pi.sent[0]?.message).toContain("sibling-task");
	});

	it("records a spawned run exactly once and clears it after flush", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "slow-task", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));

		// Exactly once: the run is spawned during the tick and not re-fired on a second pass.
		await scheduler.flush();
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		await scheduler.flush();
		expect(pi.sent.length).toBe(1);

		// Eventually: snapshot reflects the run after flush completes.
		const snapshot = scheduler.snapshot();
		expect(snapshot.activeRuns).toBe(0);
		expect(snapshot.spawnedRuns).toBe(0);
		expect(snapshot.queued).toBe(1);
	});

	it("start() catchup fires a missed run immediately", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		vi.setSystemTime("2026-01-06T09:00:00Z");
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "catchup-task", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.start({ coasHome });
		await scheduler.flush();

		expect(pi.sent.length).toBe(1);
		expect(pi.sent[0]?.message).toContain("catchup-task");
		await scheduler.stop();
	});

	it("does not replay a catchup slot after a scheduler restart", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		vi.setSystemTime("2026-01-06T09:00:00Z");
		const coasHome = makeCoasHome();
		writeSchedule(coasHome, "restart-task", "room-a", "0 9 * * 1");

		const firstPi = makePi();
		const firstScheduler = new CoasInternalScheduler(firstPi as never);
		await firstScheduler.start({ coasHome });
		await firstScheduler.flush();
		await firstScheduler.stop();

		const secondPi = makePi();
		const secondScheduler = new CoasInternalScheduler(secondPi as never);
		await secondScheduler.start({ coasHome });
		await secondScheduler.flush();
		await secondScheduler.stop();

		expect(firstPi.sent).toHaveLength(1);
		expect(secondPi.sent).toHaveLength(0);
	});

	it("deduplicates each task independently during one catchup", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		vi.setSystemTime("2026-01-06T09:00:00Z");
		const coasHome = makeCoasHome();
		writeSchedule(coasHome, "first-task", "room-a", "0 9 * * 1");
		writeSchedule(coasHome, "second-task", "room-a", "0 9 * * 1");

		const pi = makePi();
		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.start({ coasHome });
		await scheduler.flush();
		await scheduler.tick(new Date("2026-01-06T09:00:00Z"));
		await scheduler.flush();
		await scheduler.stop();

		expect(pi.sent).toHaveLength(2);
		expect(pi.sent.map((sent) => sent.message)).toEqual(expect.arrayContaining([
			expect.stringContaining("first-task"),
			expect.stringContaining("second-task"),
		]));
	});

	it("does not replace a genuinely missed slot with a clock-edge duplicate", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "edge-task", "room-a", "0 9 * * 1");
		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });

		await scheduler.tick(new Date("2026-01-05T09:00:59.999Z"));
		await scheduler.flush();
		await scheduler.tick(new Date("2026-01-05T09:01:00.001Z"));
		await scheduler.flush();
		await scheduler.stop();

		expect(pi.sent).toHaveLength(1);
	});

	it("ignores an out-of-order older tick after a newer slot was delivered", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "ordered-task", "room-a", "* * * * *");
		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });

		await scheduler.tick(new Date("2026-01-05T09:01:00Z"));
		await scheduler.flush();
		await scheduler.tick(new Date("2026-01-05T09:00:00Z"));
		await scheduler.flush();
		await scheduler.stop();

		expect(pi.sent).toHaveLength(1);
	});

	it("catchup prevents duplicate fire on the first tick", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = makeCoasHome();
		const pi = makePi();
		writeSchedule(coasHome, "once-task", "room-a", "0 9 * * 1");

		const scheduler = new CoasInternalScheduler(pi as never);
		await scheduler.reconcile({ coasHome });
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		await scheduler.flush();
		await scheduler.tick(new Date("2026-01-05T09:00:00"));
		await scheduler.flush();

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
		await scheduler.flush();
		expect(pi.sent.length).toBe(1);
	});
});

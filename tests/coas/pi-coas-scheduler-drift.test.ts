/**
 * Regression tests for the pi-coas model drift guard (T-835).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";
import { addSchedule, listSchedules } from "../../extensions/pi-coas/schedules.js";
import { formatModelLabel } from "../../extensions/pi-coas/scheduler-util.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";
const MODEL_A = "test-provider/model-a";
const MODEL_B = "test-provider/model-b";

interface ModelSelectEvent {
	model?: { provider: string; id: string };
}

type ModelSelectHandler = (event: ModelSelectEvent) => void;

interface SentPrompt {
	message: string;
	options?: unknown;
}

function makePiWithModelBus(sessionName?: string): {
	sendUserMessage: (message: string, options?: unknown) => void;
	getSessionName: () => string | undefined;
	on: (event: string, handler: (event: unknown) => void) => void;
	emitModelSelect: (event: ModelSelectEvent) => void;
	sent: SentPrompt[];
} {
	const sent: SentPrompt[] = [];
	const modelSelectHandlers: ModelSelectHandler[] = [];
	return {
		sendUserMessage(message: string, options?: unknown) {
			sent.push({ message, options });
		},
		getSessionName() {
			return sessionName;
		},
		on(event: string, handler: (event: unknown) => void) {
			if (event === "model_select") modelSelectHandlers.push(handler as ModelSelectHandler);
		},
		emitModelSelect(event: ModelSelectEvent) {
			for (const handler of modelSelectHandlers) handler(event);
		},
		get sent() {
			return sent;
		},
	};
}

async function writeSchedule(coasHome: string, taskId: string, modelSnapshot?: string): Promise<void> {
	const schedulesDir = join(coasHome, "schedules");
	const promptPath = join(schedulesDir, `${taskId}.prompt`);
	await mkdir(schedulesDir, { recursive: true });
	await writeFile(promptPath, "Review pending items.\n", "utf8");
	const lines = [
		`TASK_ID=${taskId}`,
		`TASK_NAME=${taskId}`,
		"ROOM_ID=general",
		`WORKSPACE_ID=room-a`,
		"CRON_EXPR=0 9 * * 1",
		`PROMPT_FILE=${promptPath}`,
		"ENABLED=1",
	];
	if (modelSnapshot) lines.push(`MODEL_SNAPSHOT=${modelSnapshot}`);
	lines.push("");
	await writeFile(join(schedulesDir, `${taskId}.env`), lines.join("\n"));
}

describe("CoasInternalScheduler model drift guard", () => {
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

	it("runs when the session model matches the creation snapshot", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = join(tmpdir(), `pi-coas-md-match-${process.pid}-${Date.now()}`);
		const pi = makePiWithModelBus();
		const scheduler = new CoasInternalScheduler(pi as never);
		pi.emitModelSelect({ model: { provider: "test-provider", id: "model-a" } });
		try {
			await writeSchedule(coasHome, "daily", MODEL_A);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(scheduler.snapshot().skippedRuns).toBe(0);
			expect(scheduler.snapshot().failed).toBe(0);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("fails closed with a delivered alert when the session model drifted", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = join(tmpdir(), `pi-coas-md-drift-${process.pid}-${Date.now()}`);
		const pi = makePiWithModelBus();
		const scheduler = new CoasInternalScheduler(pi as never);
		pi.emitModelSelect({ model: { provider: "test-provider", id: "model-b" } });
		try {
			await writeSchedule(coasHome, "daily", MODEL_A);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();

			// Skipped, not failed: exactly one delivery, and it is the alert.
			expect(pi.sent.length).toBe(1);
			expect(pi.sent[0]?.message).toContain("model drift");
			expect(pi.sent[0]?.message).toContain(MODEL_A);
			expect(pi.sent[0]?.message).toContain(MODEL_B);
			expect(scheduler.snapshot().skippedRuns).toBe(1);
			expect(scheduler.snapshot().failed).toBe(0);
			expect(scheduler.snapshot().queued).toBe(0);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("resumes once the session model is resolved back to the snapshot", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = join(tmpdir(), `pi-coas-md-resolve-${process.pid}-${Date.now()}`);
		const pi = makePiWithModelBus();
		const scheduler = new CoasInternalScheduler(pi as never);
		pi.emitModelSelect({ model: { provider: "test-provider", id: "model-b" } });
		try {
			await writeSchedule(coasHome, "daily", MODEL_A);
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(1);
			expect(scheduler.snapshot().skippedRuns).toBe(1);

			// Model resolved back to the snapshotted identity.
			pi.emitModelSelect({ model: { provider: "test-provider", id: "model-a" } });
			await scheduler.tick(new Date("2026-01-12T09:00:00"));
			await scheduler.flush();
			expect(pi.sent.length).toBe(2);
			expect(pi.sent[1]?.message).toContain("Review pending items");
			expect(scheduler.snapshot().failed).toBe(0);
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("leaves schedules without a model snapshot ungoverned", async () => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		const coasHome = join(tmpdir(), `pi-coas-md-ungov-${process.pid}-${Date.now()}`);
		const pi = makePiWithModelBus();
		const scheduler = new CoasInternalScheduler(pi as never);
		pi.emitModelSelect({ model: { provider: "test-provider", id: "model-b" } });
		try {
			await writeSchedule(coasHome, "daily");
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

	it("round-trips MODEL_SNAPSHOT through the schedule registry", async () => {
		const coasHome = join(tmpdir(), `pi-coas-md-persist-${process.pid}-${Date.now()}`);
		try {
			const created = await addSchedule({ coasHome }, {
				room: "general",
				name: "pinned",
				cron: "0 9 * * 1",
				prompt: "Work.",
				workspace: "room-a",
				modelSnapshot: MODEL_A,
			});
			expect(created.modelSnapshot).toBe(MODEL_A);
			const loaded = await listSchedules({ coasHome });
			expect(loaded[0]?.modelSnapshot).toBe(MODEL_A);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("formats model labels as provider/id and is undefined without a model", () => {
		expect(formatModelLabel({ provider: "p", id: "m" })).toBe("p/m");
		expect(formatModelLabel(undefined)).toBeUndefined();
		expect(formatModelLabel({ provider: "", id: "m" })).toBeUndefined();
	});
});
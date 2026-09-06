/** Regression tests for model-agnostic pi-coas schedule delivery. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiScheduler } from "../../extensions/pi-coas/pi-scheduler.js";
import { addSchedule, listSchedules } from "../../extensions/pi-coas/schedules.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

interface SentPrompt {
	message: string;
	options?: unknown;
}

function makePi(sessionName?: string): {
	sendUserMessage: (message: string, options?: unknown) => void;
	getSessionName: () => string | undefined;
	on: (event: string, handler: (event: unknown) => void) => void;
	registeredEvents: string[];
	sent: SentPrompt[];
} {
	const sent: SentPrompt[] = [];
	const registeredEvents: string[] = [];
	return {
		sendUserMessage(message: string, options?: unknown) {
			sent.push({ message, options });
		},
		getSessionName() {
			return sessionName;
		},
		on(event: string) {
			registeredEvents.push(event);
		},
		registeredEvents,
		sent,
	};
}

async function writeLegacyPinnedSchedule(coasHome: string, taskId: string): Promise<void> {
	const schedulesDir = join(coasHome, "schedules");
	const promptPath = join(schedulesDir, `${taskId}.prompt`);
	await mkdir(schedulesDir, { recursive: true });
	await writeFile(promptPath, "Review pending items.\n", "utf8");
	await writeFile(join(schedulesDir, `${taskId}.env`), [
		`TASK_ID=${taskId}`,
		`TASK_NAME=${taskId}`,
		"ROOM_ID=general",
		"WORKSPACE_ID=room-a",
		"CRON_EXPR=0 9 * * 1",
		`PROMPT_FILE=${promptPath}`,
		"MODEL_SNAPSHOT=old-provider/old-model",
		"ENABLED=1",
		"",
	].join("\n"));
}

describe("PiScheduler model-agnostic delivery", () => {
	const previousEnv: Record<string, string | undefined> = {
		[COAS_WORKSPACE_ID_ENV]: process.env[COAS_WORKSPACE_ID_ENV],
		[PANOPTICON_SCOPE_ENV]: process.env[PANOPTICON_SCOPE_ENV],
		[PANOPTICON_SPAWN_NAME_ENV]: process.env[PANOPTICON_SPAWN_NAME_ENV],
	};

	beforeEach(() => {
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		delete process.env[PANOPTICON_SCOPE_ENV];
		delete process.env[PANOPTICON_SPAWN_NAME_ENV];
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("runs a legacy model-pinned schedule without subscribing to model changes", async () => {
		const coasHome = join(tmpdir(), `pi-coas-model-agnostic-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new PiScheduler(pi as never);
		try {
			await writeLegacyPinnedSchedule(coasHome, "daily");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			expect(pi.registeredEvents).not.toContain("model_select");
			expect(pi.sent).toHaveLength(1);
			expect(pi.sent[0]?.message).toContain("Review pending items");
			expect(scheduler.snapshot()).toMatchObject({ queued: 1, skippedRuns: 0, failed: 0 });
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("continues delivering the same schedule across trigger dates independent of session model", async () => {
		const coasHome = join(tmpdir(), `pi-coas-model-change-${process.pid}-${Date.now()}`);
		const pi = makePi();
		const scheduler = new PiScheduler(pi as never);
		try {
			await writeLegacyPinnedSchedule(coasHome, "weekly");
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();
			await scheduler.tick(new Date("2026-01-12T09:00:00"));
			await scheduler.flush();
			expect(pi.sent).toHaveLength(2);
			expect(scheduler.snapshot()).toMatchObject({ queued: 2, skippedRuns: 0, failed: 0 });
		} finally {
			await scheduler.stop();
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("does not write model identity into newly created schedules", async () => {
		const coasHome = join(tmpdir(), `pi-coas-model-persist-${process.pid}-${Date.now()}`);
		try {
			const created = await addSchedule({ coasHome }, {
				room: "general",
				name: "agnostic",
				cron: "0 9 * * 1",
				prompt: "Work.",
				workspace: "room-a",
			});
			const env = await readFile(join(coasHome, "schedules", `${created.taskId}.env`), "utf8");
			expect(env).not.toContain("MODEL_SNAPSHOT");
			const loaded = await listSchedules({ coasHome });
			expect(loaded[0]).not.toHaveProperty("modelSnapshot");
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});
});

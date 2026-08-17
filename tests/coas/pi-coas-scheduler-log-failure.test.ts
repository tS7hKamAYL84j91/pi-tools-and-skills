/** Deterministic test for schedule log-write failure telemetry. */
import { describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";

vi.mock("../../lib/file-persistence.js", () => ({
	appendLogLine: vi.fn(async () => {
		throw new Error("disk full");
	}),
}));

import { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";

const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

describe("CoasInternalScheduler log-write failure", () => {
	it("records queued telemetry only and bounds lastError when log write fails after sendUserMessage succeeds", async () => {
		const previousEnv: Record<string, string | undefined> = {
			[COAS_WORKSPACE_ID_ENV]: process.env[COAS_WORKSPACE_ID_ENV],
			[PANOPTICON_SCOPE_ENV]: process.env[PANOPTICON_SCOPE_ENV],
			[PANOPTICON_SPAWN_NAME_ENV]: process.env[PANOPTICON_SPAWN_NAME_ENV],
		};
		process.env[COAS_WORKSPACE_ID_ENV] = "room-a";
		delete process.env[PANOPTICON_SCOPE_ENV];
		delete process.env[PANOPTICON_SPAWN_NAME_ENV];
		const coasHome = join(tmpdir(), `pi-coas-log-fail-${process.pid}-${Date.now()}`);
		const schedulesDir = join(coasHome, "schedules");
		const promptPath = join(schedulesDir, "daily.prompt");
		await mkdir(schedulesDir, { recursive: true });
		await writeFile(promptPath, "Do work.\n", "utf8");
		await writeFile(join(schedulesDir, "daily.env"), [
			"TASK_ID=daily",
			"TASK_NAME=Daily",
			"ROOM_ID=general",
			"WORKSPACE_ID=room-a",
			"CRON_EXPR=0 9 * * 1",
			`PROMPT_FILE=${promptPath}`,
			"ENABLED=1",
			"",
		].join("\n"));
		const calls: string[] = [];
		const scheduler = new CoasInternalScheduler({
			sendUserMessage(message: string) {
				calls.push(message);
			},
			getSessionName() {
				return undefined;
			},
		} as never);
		try {
			await scheduler.reconcile({ coasHome });
			await scheduler.tick(new Date("2026-01-05T09:00:00"));
			await scheduler.flush();

			const snapshot = scheduler.snapshot();
			expect(snapshot.queued).toBe(1);
			expect(snapshot.failed).toBe(0);
			expect(snapshot.lastTaskId).toBe("daily");
			expect(snapshot.lastQueuedAt).toMatch(/^\d{4}-/);
			expect(snapshot.lastError).toBe("disk full");
			expect(calls.length).toBe(1);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
			for (const [key, value] of Object.entries(previousEnv)) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	});
});

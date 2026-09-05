/** CoAS schedules + internal scheduler unit tests. */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PiScheduler,
	renderScheduledPrompt,
	scheduleMatchesDate,
} from "../../extensions/pi-coas/pi-scheduler.js";
import {
	addSchedule,
	validateCronExpr,
	formatScheduleList,
	renderInternalSchedulePlan,
} from "../../extensions/pi-coas/schedules.js";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";
import type { ScheduleEntry } from "../../extensions/pi-coas/types.js";

describe("schedules", () => {
	describe("validateCronExpr", () => {
		it("accepts valid five-field cron", () => {
			expect(() => validateCronExpr("0 9 * * 1")).not.toThrow();
		});

		it("rejects fewer than five fields", () => {
			expect(() => validateCronExpr("0 9 * *")).toThrow(/five fields/);
		});

		it("rejects empty fields", () => {
			expect(() => validateCronExpr("0 9  * *")).toThrow(/five fields/);
		});

		it("rejects expressions with more than five fields", () => {
			expect(() => validateCronExpr("0 9 * * 1 extra")).toThrow(/five fields/);
		});

		it("rejects out-of-range minute fields", () => {
			expect(() => validateCronExpr("99 9 * * 1")).toThrow(
				/minute field is invalid/,
			);
		});

		it("rejects out-of-range hour fields", () => {
			expect(() => validateCronExpr("0 24 * * 1")).toThrow(
				/hour field is invalid/,
			);
		});

		it("rejects out-of-range day-of-month fields", () => {
			expect(() => validateCronExpr("0 9 32 * 1")).toThrow(
				/day-of-month field is invalid/,
			);
		});

		it("rejects out-of-range month fields", () => {
			expect(() => validateCronExpr("0 9 * 13 1")).toThrow(
				/month field is invalid/,
			);
		});

		it("rejects out-of-range day-of-week fields", () => {
			expect(() => validateCronExpr("0 9 * * 8")).toThrow(
				/day-of-week field is invalid/,
			);
		});
	});

	describe("internal scheduler helpers", () => {
		const mondayNine = new Date("2026-01-05T09:00:00");

		it("matches exact due minute", () => {
			expect(scheduleMatchesDate("0 9 * * 1", mondayNine)).toBe(true);
		});

		it("does not match outside due minute", () => {
			expect(scheduleMatchesDate("30 9 * * 1", mondayNine)).toBe(false);
		});

		it("supports stepped minute fields", () => {
			expect(scheduleMatchesDate("*/15 9 * * 1", mondayNine)).toBe(true);
		});

		it("treats both 0 and 7 as Sunday", () => {
			const sunday = new Date("2026-01-04T09:00:00");
			expect(scheduleMatchesDate("0 9 * * 0", sunday)).toBe(true);
			expect(scheduleMatchesDate("0 9 * * 7", sunday)).toBe(true);
		});

		it("renders scheduled prompts with metadata", () => {
			const prompt = renderScheduledPrompt({
				taskId: "daily-check",
				taskName: "Daily Check",
				roomId: "general",
				workspaceId: "room-general",
				cronExpr: "0 9 * * 1",
				enabled: true,
				promptFile: "/tmp/daily-check.prompt",
				prompt: "Summarize the workspace.",
			});
			expect(prompt).toContain("Daily Check");
			expect(prompt).toContain("room-general");
			expect(prompt).toContain("Summarize the workspace.");
		});
	});

	describe("PiScheduler", () => {
		const COAS_WORKSPACE_ID_ENV = "COAS_WORKSPACE_ID";
		const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";
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
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		});

		it("clears runtime state on stop", async () => {
			const scheduler = new PiScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			scheduler.start({ coasHome: join(tmpdir(), "missing-coas-home") });

			await scheduler.stop();

			expect(scheduler.snapshot()).toEqual({
				running: false,
				enabledSchedules: 0,
				activeRuns: 0,
				startedAt: undefined,
				lastError: undefined,
				queued: 0,
				failed: 0,
				droppedScheduleRuns: 0,
				skippedRuns: 0,
				lastQueuedAt: undefined,
				lastFailedAt: undefined,
				lastTaskId: undefined,
				continuationSchedules: 0,
				continuationReady: 0,
				awaitingApprovalCount: 0,
				spawnedRuns: 0,
			});
		});

		it("records queued telemetry on successful sendUserMessage", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-queued-${process.pid}-${Date.now()}`,
			);
			const schedulesDir = join(coasHome, "schedules");
			const promptPath = join(schedulesDir, "daily.prompt");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(promptPath, "Do work.\n", "utf8");
			await writeFile(
				join(schedulesDir, "daily.env"),
				[
					"TASK_ID=daily",
					"TASK_NAME=Daily",
					"ROOM_ID=general",
					"WORKSPACE_ID=room-a",
					"CRON_EXPR=0 9 * * 1",
					`PROMPT_FILE=${promptPath}`,
					"ENABLED=1",
					"",
				].join("\n"),
			);
			const calls: string[] = [];
			let activeDuringSend = 0;
			const scheduler = new PiScheduler({
				sendUserMessage(message: string) {
					activeDuringSend = scheduler.snapshot().activeRuns;
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
				expect(snapshot.activeRuns).toBe(0);
				expect(activeDuringSend).toBe(1);
				expect(calls.length).toBe(1);
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("records failed telemetry when sendUserMessage throws", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-failed-${process.pid}-${Date.now()}`,
			);
			const schedulesDir = join(coasHome, "schedules");
			const promptPath = join(schedulesDir, "daily.prompt");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(promptPath, "Do work.\n", "utf8");
			await writeFile(
				join(schedulesDir, "daily.env"),
				[
					"TASK_ID=daily",
					"TASK_NAME=Daily",
					"ROOM_ID=general",
					"WORKSPACE_ID=room-a",
					"CRON_EXPR=0 9 * * 1",
					`PROMPT_FILE=${promptPath}`,
					"ENABLED=1",
					"",
				].join("\n"),
			);
			const scheduler = new PiScheduler({
				sendUserMessage() {
					throw new Error("injection refused");
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
				expect(snapshot.queued).toBe(0);
				expect(snapshot.failed).toBe(1);
				expect(snapshot.lastTaskId).toBe("daily");
				expect(snapshot.lastFailedAt).toMatch(/^\d{4}-/);
				expect(snapshot.lastError).toBe("injection refused");
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("resets telemetry counters and timestamps on stop", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-reset-${process.pid}-${Date.now()}`,
			);
			const schedulesDir = join(coasHome, "schedules");
			const promptPath = join(schedulesDir, "daily.prompt");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(promptPath, "Do work.\n", "utf8");
			await writeFile(
				join(schedulesDir, "daily.env"),
				[
					"TASK_ID=daily",
					"TASK_NAME=Daily",
					"ROOM_ID=general",
					"WORKSPACE_ID=room-a",
					"CRON_EXPR=0 9 * * 1",
					`PROMPT_FILE=${promptPath}`,
					"ENABLED=1",
					"",
				].join("\n"),
			);
			const scheduler = new PiScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			try {
				await scheduler.reconcile({ coasHome });
				await scheduler.tick(new Date("2026-01-05T09:00:00"));
				await scheduler.flush();
				expect(scheduler.snapshot().queued).toBe(1);

				await scheduler.stop();

				expect(scheduler.snapshot()).toEqual({
					running: false,
					enabledSchedules: 0,
					activeRuns: 0,
					startedAt: undefined,
					lastError: undefined,
					queued: 0,
					failed: 0,
					droppedScheduleRuns: 0,
					skippedRuns: 0,
					lastQueuedAt: undefined,
					lastFailedAt: undefined,
					lastTaskId: undefined,
					continuationSchedules: 0,
					continuationReady: 0,
					awaitingApprovalCount: 0,
					spawnedRuns: 0,
				});
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("records reconcile errors instead of silently hiding them", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-bad-schedule-${process.pid}-${Date.now()}`,
			);
			const schedulesDir = join(coasHome, "schedules");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(
				join(schedulesDir, "bad.env"),
				"TASK_ID=bad\nCRON_EXPR=not-enough\nPROMPT_FILE=bad.prompt\nWORKSPACE_ID=room-a\n",
			);
			const scheduler = new PiScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			try {
				await scheduler.reconcile({ coasHome });

				expect(scheduler.snapshot().enabledSchedules).toBe(0);
				expect(scheduler.snapshot().lastError).toContain(
					"Cron expression must have exactly five fields",
				);
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("records malformed schedule expressions during ticks", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-invalid-field-${process.pid}-${Date.now()}`,
			);
			const schedulesDir = join(coasHome, "schedules");
			const promptPath = join(schedulesDir, "bad.prompt");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(promptPath, "Do work.\n");
			await writeFile(
				join(schedulesDir, "bad.env"),
				[
					"TASK_ID=bad",
					"TASK_NAME=Bad",
					"ROOM_ID=general",
					"WORKSPACE_ID=room-a",
					"CRON_EXPR=99 9 * * 1",
					`PROMPT_FILE=${promptPath}`,
					"ENABLED=1",
					"",
				].join("\n"),
			);
			const scheduler = new PiScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			try {
				await scheduler.reconcile({ coasHome });
				await scheduler.tick(new Date("2026-01-05T09:00:00"));
				await scheduler.flush();

				expect(scheduler.snapshot().lastError).toContain("schedule bad");
				expect(scheduler.snapshot().lastError).toContain(
					"minute field is invalid",
				);
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});
	});

	describe("addSchedule", () => {
		it("rejects invalid cron fields before writing schedule files", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-invalid-add-${process.pid}-${Date.now()}`,
			);
			try {
				await expect(
					addSchedule(
						{ coasHome },
						{
							room: "general",
							name: "Bad Schedule",
							cron: "99 9 * * 1",
							prompt: "Do work.",
						},
					),
				).rejects.toThrow(/minute field is invalid/);
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});
	});

	describe("renderInternalSchedulePlan", () => {
		it("previews enabled schedules without prompt text", async () => {
			const coasHome = join(
				tmpdir(),
				`pi-coas-preview-${process.pid}-${Date.now()}`,
			);
			try {
				await addSchedule(
					{ coasHome },
					{
						room: "general",
						name: "Daily Check",
						cron: "0 9 * * 1",
						prompt: "private prompt sentinel",
					},
				);

				const result = await renderInternalSchedulePlan({ coasHome });

				expect(result.code).toBe(0);
				expect(result.stdout).toContain(
					"0 9 * * 1 daily-check -> pi-scheduler",
				);
				expect(result.stdout).not.toContain("private prompt sentinel");
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});
	});

	describe("formatScheduleList", () => {
		it("formats schedule table with header", () => {
			const entry: ScheduleEntry = {
				taskId: "daily-check",
				taskName: "Daily Check",
				roomId: "general",
				workspaceId: "room-general",
				cronExpr: "0 9 * * 1",
				enabled: true,
				promptFile: "/tmp/daily-check.prompt",
			};
			const result = formatScheduleList([entry]);
			expect(result).toContain("TASK");
			expect(result).toContain("daily-check");
			expect(result).toContain("Daily Check");
		});

		it("formats empty list", () => {
			expect(formatScheduleList([])).toContain("TASK");
		});
	});
});

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderSchedulerSnapshot, shortCommandSummary, truncateText } from "../../extensions/pi-coas/format.js";
import { resolveCoasConfig, resolveCoasConfigForCwd } from "../../extensions/pi-coas/config.js";
import { formatCoasStatusSlot, registerCoasLifecycle } from "../../extensions/pi-coas/lifecycle.js";
import { assertSafeId, formatEnv, parseEnv, pathInside, slugify, workspaceIdFromRoom } from "../../extensions/pi-coas/store-paths.js";
import { CoasInternalScheduler, renderScheduledPrompt, scheduleMatchesDate } from "../../extensions/pi-coas/scheduler.js";
import { addSchedule, validateCronExpr, formatScheduleList, renderInternalSchedulePlan } from "../../extensions/pi-coas/schedules.js";
import { coasStatus } from "../../extensions/pi-coas/status.js";
import { appendWorkspaceContext, createWorkspace, readWorkspaceContext } from "../../extensions/pi-coas/workspaces.js";
import { ok, fail } from "../../lib/tool-result.js";
import type { CommandResult, ScheduleEntry } from "../../extensions/pi-coas/types.js";

describe("store", () => {
	describe("slugify", () => {
		it("lowercases and replaces separators", () => {
			expect(slugify("My Workspace")).toBe("my-workspace");
		});

		it("collapses multiple separators", () => {
			expect(slugify("a---b")).toBe("a-b");
		});

		it("trims leading/trailing separators", () => {
			expect(slugify("-hello-")).toBe("hello");
		});

		it("returns fallback for empty string", () => {
			expect(slugify("", "fallback")).toBe("fallback");
		});

		it("returns fallback for all-special input", () => {
			expect(slugify("---", "fallback")).toBe("fallback");
		});
	});

	describe("workspaceIdFromRoom", () => {
		it("prefixes slugified room", () => {
			expect(workspaceIdFromRoom("general")).toBe("room-general");
		});
	});

	describe("assertSafeId", () => {
		it("accepts valid ids", () => {
			expect(() => assertSafeId("test", "abc123")).not.toThrow();
		});

		it("rejects ids with spaces", () => {
			expect(() => assertSafeId("test", "abc 123")).toThrow(/Invalid/);
		});

		it("rejects ids with ..", () => {
			expect(() => assertSafeId("test", "a..b")).toThrow(/Invalid/);
		});
	});

	describe("pathInside", () => {
		it("returns true for child path", () => {
			expect(pathInside("/root", "/root/child")).toBe(true);
		});

		it("returns true for exact match", () => {
			expect(pathInside("/root", "/root")).toBe(true);
		});

		it("returns false for sibling", () => {
			expect(pathInside("/root", "/other")).toBe(false);
		});

		it("returns false for escape attempt", () => {
			expect(pathInside("/root", "/root/../other")).toBe(false);
		});
	});

	describe("parseEnv / formatEnv", () => {
		it("round-trips simple values", () => {
			const values = { KEY: "value", NUM: "42" };
			expect(parseEnv(formatEnv(values))).toEqual(values);
		});

		it("ignores comments and blank lines", () => {
			const content = "# comment\n\nKEY=val\n\n";
			expect(parseEnv(content)).toEqual({ KEY: "val" });
		});

		it("unquotes single-quoted values", () => {
			expect(parseEnv("KEY='hello world'")).toEqual({ KEY: "hello world" });
		});

		it("unquotes double-quoted values", () => {
			expect(parseEnv('KEY="hello world"')).toEqual({ KEY: "hello world" });
		});

		it("skips lines without equals", () => {
			expect(parseEnv("NOEQUALS\nKEY=val")).toEqual({ KEY: "val" });
		});
	});
});

describe("config", () => {
	it("uses baseCwd when no override cwd is provided", async () => {
		const previousCoasHome = process.env.COAS_HOME;
		delete process.env.COAS_HOME;
		const project = join(tmpdir(), `pi-coas-base-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(project, ".pi", "coas", "workspace"), { recursive: true });
			const config = await resolveCoasConfigForCwd(project);
			expect(config.coasHome).toBe(join(project, ".pi", "coas"));
		} finally {
			if (previousCoasHome === undefined) {
				delete process.env.COAS_HOME;
			} else {
				process.env.COAS_HOME = previousCoasHome;
			}
			await rm(project, { recursive: true, force: true });
		}
	});

	it("resolves CoAS_HOME from an override cwd", async () => {
		const previousCoasHome = process.env.COAS_HOME;
		delete process.env.COAS_HOME;
		const base = join(tmpdir(), `pi-coas-base-override-${process.pid}-${Date.now()}`);
		const other = join(tmpdir(), `pi-coas-other-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(base, ".pi", "coas", "workspace"), { recursive: true });
			await mkdir(join(other, ".pi", "coas", "workspace"), { recursive: true });
			const config = await resolveCoasConfigForCwd(base, other);
			expect(config.coasHome).toBe(join(other, ".pi", "coas"));
		} finally {
			if (previousCoasHome === undefined) {
				delete process.env.COAS_HOME;
			} else {
				process.env.COAS_HOME = previousCoasHome;
			}
			await rm(base, { recursive: true, force: true });
			await rm(other, { recursive: true, force: true });
		}
	});

	it("rejects a non-existent override cwd", async () => {
		const previousCoasHome = process.env.COAS_HOME;
		delete process.env.COAS_HOME;
		const missing = join(tmpdir(), `pi-coas-missing-${process.pid}-${Date.now()}`);
		try {
			await expect(resolveCoasConfigForCwd(process.cwd(), missing)).rejects.toThrow(/No such directory/);
		} finally {
			if (previousCoasHome === undefined) {
				delete process.env.COAS_HOME;
			} else {
				process.env.COAS_HOME = previousCoasHome;
			}
		}
	});

	it("rejects an override cwd without a CoAS runtime", async () => {
		const previousCoasHome = process.env.COAS_HOME;
		delete process.env.COAS_HOME;
		const base = join(tmpdir(), `pi-coas-base-no-runtime-${process.pid}-${Date.now()}`);
		const empty = join(tmpdir(), `pi-coas-empty-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(base, ".pi", "coas", "workspace"), { recursive: true });
			await mkdir(empty, { recursive: true });
			await expect(resolveCoasConfigForCwd(base, empty)).rejects.toThrow(/No CoAS runtime found under/);
		} finally {
			if (previousCoasHome === undefined) {
				delete process.env.COAS_HOME;
			} else {
				process.env.COAS_HOME = previousCoasHome;
			}
			await rm(base, { recursive: true, force: true });
			await rm(empty, { recursive: true, force: true });
		}
	});

	it("rejects an override cwd that is a file", async () => {
		const previousCoasHome = process.env.COAS_HOME;
		delete process.env.COAS_HOME;
		const base = join(tmpdir(), `pi-coas-base-file-${process.pid}-${Date.now()}`);
		const file = join(tmpdir(), `pi-coas-file-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(base, ".pi", "coas", "workspace"), { recursive: true });
			await writeFile(file, "not a directory", "utf8");
			await expect(resolveCoasConfigForCwd(base, file)).rejects.toThrow(/No such directory/);
		} finally {
			if (previousCoasHome === undefined) {
				delete process.env.COAS_HOME;
			} else {
				process.env.COAS_HOME = previousCoasHome;
			}
			await rm(base, { recursive: true, force: true });
			await rm(file, { recursive: true, force: true });
		}
	});
});

describe("workspaces", () => {
	it("prefers project-local singular workspace root before global fallback", async () => {
		const previousCoasHome = process.env.COAS_HOME;
		delete process.env.COAS_HOME;
		const project = join(tmpdir(), `pi-coas-project-${process.pid}-${Date.now()}`);
		const nested = join(project, "repo", "subdir");
		const workspaceDir = join(project, "repo", ".pi", "coas", "workspace", "local");
		try {
			await mkdir(nested, { recursive: true });
			await mkdir(workspaceDir, { recursive: true });
			await writeFile(join(workspaceDir, "CONTEXT.md"), "# Local\n", "utf8");

			const config = resolveCoasConfig(nested);

			expect(config.coasHome).toBe(join(project, "repo", ".pi", "coas"));
		} finally {
			if (previousCoasHome === undefined) {
				delete process.env.COAS_HOME;
			} else {
				process.env.COAS_HOME = previousCoasHome;
			}
			await rm(project, { recursive: true, force: true });
		}
	});

	it("returns summary metadata by default instead of full context", async () => {
		const coasHome = join(tmpdir(), `pi-coas-summary-${process.pid}-${Date.now()}`);
		try {
			await createWorkspace({ coasHome }, { room: "general", workspace: "alpha" });
			const contextPath = join(coasHome, "workspace", "alpha", "CONTEXT.md");
			await writeFile(contextPath, `# Alpha\n\n## Stable Memory\n\nsmall fact\n\n## Private Detail\n\n${"x".repeat(20 * 1024)}\n`, "utf8");

			const result = await readWorkspaceContext({ coasHome }, "alpha", coasHome);

			expect(result.mode).toBe("summary");
			expect(result.text).toContain("Size:");
			expect(result.text).toContain("## Stable Memory");
			expect(result.text.length).toBeLessThan(13 * 1024);
			expect(result.text).not.toContain("x".repeat(13 * 1024));
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("guards full and section reads for oversized context files", async () => {
		const coasHome = join(tmpdir(), `pi-coas-guard-${process.pid}-${Date.now()}`);
		try {
			await createWorkspace({ coasHome }, { room: "general", workspace: "alpha" });
			await writeFile(join(coasHome, "workspace", "alpha", "CONTEXT.md"), `# Alpha\n\n${"x".repeat(130 * 1024)}\n`, "utf8");

			await expect(readWorkspaceContext({ coasHome }, "alpha", coasHome, { mode: "full" })).rejects.toThrow(/full reads are limited/);
			await expect(readWorkspaceContext({ coasHome }, "alpha", coasHome, { mode: "section", section: "Alpha" })).rejects.toThrow(/section reads are limited/);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});

	it("compacts oversized active context and archives the previous content", async () => {
		const coasHome = join(tmpdir(), `pi-coas-compact-${process.pid}-${Date.now()}`);
		try {
			await createWorkspace({ coasHome }, { room: "general", workspace: "alpha" });
			const workspaceDir = join(coasHome, "workspace", "alpha");
			await writeFile(join(workspaceDir, "CONTEXT.md"), `# Alpha\n\n${"old detail\n".repeat(9000)}`, "utf8");

			const result = await appendWorkspaceContext({ coasHome }, "alpha", coasHome, "new stable fact");
			const active = await readFile(result.path, "utf8");

			expect(active).toContain("# CoAS Workspace Context (SPR)");
			expect(active).toContain("new stable fact");
			expect(active.length).toBeLessThan(4096);
			expect(existsSync(join(workspaceDir, "archive"))).toBe(true);
		} finally {
			await rm(coasHome, { recursive: true, force: true });
		}
	});
});

describe("lifecycle", () => {
	it("awaits scheduler stop before clearing shutdown status", async () => {
		let releaseStop: (() => void) | undefined;
		const stopPending = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		const handlers = new Map<string, (event: unknown, ctx: { ui: { setStatus: (key: string, value: string | undefined) => void } }) => Promise<unknown>>();
		const setStatus = vi.fn();
		const stop = vi.fn(() => stopPending);
		registerCoasLifecycle({
			on(event: string, handler: (event: unknown, ctx: { ui: { setStatus: (key: string, value: string | undefined) => void } }) => Promise<unknown>) {
				handlers.set(event, handler);
			},
		} as never, { stop } as never);
		const shutdown = handlers.get("session_shutdown");
		if (!shutdown) throw new Error("session_shutdown handler was not registered");

		const shutdownPending = shutdown({}, { ui: { setStatus } });
		await Promise.resolve();
		expect(stop).toHaveBeenCalledOnce();
		expect(setStatus).not.toHaveBeenCalled();

		releaseStop?.();
		await shutdownPending;
		expect(setStatus).toHaveBeenCalledWith("coas", undefined);
	});

	describe("formatCoasStatusSlot", () => {
		it("uses extension-prefixed status text", () => {
			expect(formatCoasStatusSlot()).toBe("coas: on ✓");
		});

		it("keeps workspace context after the extension prefix", () => {
			expect(formatCoasStatusSlot("room-general")).toBe("coas: room-general");
		});

		it("includes scheduler health and active run counts when available", () => {
			expect(formatCoasStatusSlot("exec-office", {
				running: true,
				enabledSchedules: 3,
				activeRuns: 1,
				startedAt: "2026-01-01T00:00:00Z",
			})).toBe("coas: exec-office ✓ sch 3/1");
		});

		it("marks scheduler errors without using personality metaphors", () => {
			expect(formatCoasStatusSlot(undefined, {
				running: true,
				enabledSchedules: 0,
				activeRuns: 0,
				startedAt: "2026-01-01T00:00:00Z",
				lastError: "boom",
			})).toBe("coas: on ⚠");
		});

		it("includes queued telemetry in compact TUI status", () => {
			expect(formatCoasStatusSlot("exec-office", {
				running: true,
				enabledSchedules: 3,
				activeRuns: 1,
				startedAt: "2026-01-01T00:00:00Z",
				queued: 2,
			})).toBe("coas: exec-office ✓ sch 3/1 q2");
		});

		it("includes failed telemetry only when non-zero", () => {
			expect(formatCoasStatusSlot(undefined, {
				running: true,
				enabledSchedules: 1,
				activeRuns: 0,
				startedAt: "2026-01-01T00:00:00Z",
				queued: 1,
				failed: 1,
			})).toBe("coas: on ✓ sch 1/0 q1 f1");
		});
	});

	describe("coasStatus", () => {
		it("discloses telemetry fields when scheduler snapshot includes them", async () => {
			const coasHome = join(tmpdir(), `pi-coas-status-telemetry-${process.pid}-${Date.now()}`);
			try {
				await mkdir(join(coasHome, "schedules"), { recursive: true });
				const result = await coasStatus({ coasHome }, {
					running: true,
					enabledSchedules: 0,
					activeRuns: 0,
					queued: 3,
					failed: 1,
					lastQueuedAt: "2026-01-05T09:00:00Z",
					lastFailedAt: "2026-01-05T09:01:00Z",
					lastTaskId: "daily",
				});

				expect(result.stdout).toContain("queued             3");
				expect(result.stdout).toContain("failed             1");
				expect(result.stdout).toContain("last queued        2026-01-05T09:00:00Z");
				expect(result.stdout).toContain("last failed        2026-01-05T09:01:00Z");
				expect(result.stdout).toContain("last task          daily");
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("omits telemetry fields when scheduler snapshot is absent", async () => {
			const coasHome = join(tmpdir(), `pi-coas-status-no-telemetry-${process.pid}-${Date.now()}`);
			try {
				await mkdir(join(coasHome, "schedules"), { recursive: true });
				const result = await coasStatus({ coasHome });

				expect(result.stdout).not.toContain("queued");
				expect(result.stdout).not.toContain("failed");
				expect(result.stdout).not.toContain("last queued");
				expect(result.stdout).not.toContain("last failed");
				expect(result.stdout).not.toContain("last task");
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});
	});
});

describe("format", () => {
	describe("shortCommandSummary", () => {
		it("shows exit code and limited lines", () => {
			const result: CommandResult = { code: 0, stdout: ["a", "b", "c", "d", "e"].join("\n"), stderr: "" };
			const summary = shortCommandSummary("test", result, 3);
			expect(summary).toBe("test exit=0\na\nb\nc\n...");
		});

		it("does not add ellipsis when output fits", () => {
			const result: CommandResult = { code: 1, stdout: "a\nb", stderr: "" };
			const summary = shortCommandSummary("test", result, 4);
			expect(summary).toBe("test exit=1\na\nb");
		});
	});

	describe("renderSchedulerSnapshot", () => {
		it("summarizes internal scheduler state", () => {
			const rendered = renderSchedulerSnapshot({
				running: true,
				enabledSchedules: 2,
				activeRuns: 1,
				startedAt: "2026-01-01T00:00:00Z",
			});
			expect(rendered).toContain("running           yes");
			expect(rendered).toContain("enabled schedules 2");
		});

		it("discloses telemetry fields only when present", () => {
			const rendered = renderSchedulerSnapshot({
				running: true,
				enabledSchedules: 1,
				activeRuns: 0,
				startedAt: "2026-01-01T00:00:00Z",
				queued: 3,
				failed: 1,
				lastQueuedAt: "2026-01-01T00:05:00Z",
				lastFailedAt: "2026-01-01T00:06:00Z",
				lastTaskId: "daily",
			});
			expect(rendered).toContain("queued            3");
			expect(rendered).toContain("failed            1");
			expect(rendered).toContain("last queued at    2026-01-01T00:05:00Z");
			expect(rendered).toContain("last failed at    2026-01-01T00:06:00Z");
			expect(rendered).toContain("last task id      daily");
		});
	});

	describe("truncateText", () => {
		it("reports lines limit hit", () => {
			const long = `${"line\n".repeat(2001)}`;
			const result = truncateText(long);
			expect(result.truncated).toBe(true);
			expect(result.limitHit).toBe("lines");
		});

		it("reports bytes limit hit", () => {
			const huge = "x".repeat(60 * 1024);
			const result = truncateText(huge);
			expect(result.truncated).toBe(true);
			expect(result.limitHit).toBe("bytes");
		});

		it("returns no limit for short text", () => {
			const result = truncateText("hello\nworld");
			expect(result.truncated).toBe(false);
			expect(result.limitHit).toBeUndefined();
		});
	});
});

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
			expect(() => validateCronExpr("99 9 * * 1")).toThrow(/minute field is invalid/);
		});

		it("rejects out-of-range hour fields", () => {
			expect(() => validateCronExpr("0 24 * * 1")).toThrow(/hour field is invalid/);
		});

		it("rejects out-of-range day-of-month fields", () => {
			expect(() => validateCronExpr("0 9 32 * 1")).toThrow(/day-of-month field is invalid/);
		});

		it("rejects out-of-range month fields", () => {
			expect(() => validateCronExpr("0 9 * 13 1")).toThrow(/month field is invalid/);
		});

		it("rejects out-of-range day-of-week fields", () => {
			expect(() => validateCronExpr("0 9 * * 8")).toThrow(/day-of-week field is invalid/);
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

	describe("CoasInternalScheduler", () => {
		it("clears runtime state on stop", async () => {
			const scheduler = new CoasInternalScheduler({
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
				lastQueuedAt: undefined,
				lastFailedAt: undefined,
				lastTaskId: undefined,
				continuationSchedules: 0,
				continuationReady: 0,
				awaitingApprovalCount: 0,
			});
		});

		it("records queued telemetry on successful sendUserMessage", async () => {
			const coasHome = join(tmpdir(), `pi-coas-queued-${process.pid}-${Date.now()}`);
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
			let activeDuringSend = 0;
			const scheduler = new CoasInternalScheduler({
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
			const coasHome = join(tmpdir(), `pi-coas-failed-${process.pid}-${Date.now()}`);
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
			const scheduler = new CoasInternalScheduler({
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
			const coasHome = join(tmpdir(), `pi-coas-reset-${process.pid}-${Date.now()}`);
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
			const scheduler = new CoasInternalScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			try {
				await scheduler.reconcile({ coasHome });
				await scheduler.tick(new Date("2026-01-05T09:00:00"));
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
					lastQueuedAt: undefined,
					lastFailedAt: undefined,
					lastTaskId: undefined,
					continuationSchedules: 0,
					continuationReady: 0,
					awaitingApprovalCount: 0,
				});
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("records reconcile errors instead of silently hiding them", async () => {
			const coasHome = join(tmpdir(), `pi-coas-bad-schedule-${process.pid}-${Date.now()}`);
			const schedulesDir = join(coasHome, "schedules");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(join(schedulesDir, "bad.env"), "TASK_ID=bad\nCRON_EXPR=not-enough\nPROMPT_FILE=bad.prompt\nWORKSPACE_ID=room-a\n");
			const scheduler = new CoasInternalScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			try {
				await scheduler.reconcile({ coasHome });

				expect(scheduler.snapshot().enabledSchedules).toBe(0);
				expect(scheduler.snapshot().lastError).toContain("Cron expression must have exactly five fields");
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});

		it("records malformed schedule expressions during ticks", async () => {
			const coasHome = join(tmpdir(), `pi-coas-invalid-field-${process.pid}-${Date.now()}`);
			const schedulesDir = join(coasHome, "schedules");
			const promptPath = join(schedulesDir, "bad.prompt");
			await mkdir(schedulesDir, { recursive: true });
			await writeFile(promptPath, "Do work.\n");
			await writeFile(join(schedulesDir, "bad.env"), [
				"TASK_ID=bad",
				"TASK_NAME=Bad",
				"ROOM_ID=general",
				"WORKSPACE_ID=room-a",
				"CRON_EXPR=99 9 * * 1",
				`PROMPT_FILE=${promptPath}`,
				"ENABLED=1",
				"",
			].join("\n"));
			const scheduler = new CoasInternalScheduler({
				sendUserMessage() {},
				getSessionName() {
					return undefined;
				},
			} as never);
			try {
				await scheduler.reconcile({ coasHome });
				await scheduler.tick(new Date("2026-01-05T09:00:00"));

				expect(scheduler.snapshot().lastError).toContain("schedule bad");
				expect(scheduler.snapshot().lastError).toContain("minute field is invalid");
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});
	});

	describe("addSchedule", () => {
		it("rejects invalid cron fields before writing schedule files", async () => {
			const coasHome = join(tmpdir(), `pi-coas-invalid-add-${process.pid}-${Date.now()}`);
			try {
				await expect(addSchedule({ coasHome }, {
					room: "general",
					name: "Bad Schedule",
					cron: "99 9 * * 1",
					prompt: "Do work.",
				})).rejects.toThrow(/minute field is invalid/);
			} finally {
				await rm(coasHome, { recursive: true, force: true });
			}
		});
	});

	describe("renderInternalSchedulePlan", () => {
		it("previews enabled schedules without prompt text", async () => {
			const coasHome = join(tmpdir(), `pi-coas-preview-${process.pid}-${Date.now()}`);
			try {
				await addSchedule({ coasHome }, {
					room: "general",
					name: "Daily Check",
					cron: "0 9 * * 1",
					prompt: "private prompt sentinel",
				});

				const result = await renderInternalSchedulePlan({ coasHome });

				expect(result.code).toBe(0);
				expect(result.stdout).toContain("0 9 * * 1 daily-check -> pi internal scheduler");
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

describe("tool-result error paths", () => {
	it("ok result is not an error", () => {
		const result = ok("success", { code: 0 });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toBe("success");
	});

	it("fail result is an error", () => {
		const result = fail("No workspace selected and cwd is not a CoAS workspace");
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("No workspace selected");
	});

	it("fail result includes details", () => {
		const result = fail("Schedule already exists: daily-check", { taskId: "daily-check" });
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ taskId: "daily-check" });
	});

	it("fail result for empty context update", () => {
		const result = fail("Context update text must not be empty", { textLength: 0 });
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ textLength: 0 });
	});

	it("assertSafeId error is catchable", () => {
		try {
			assertSafeId("workspace id", "../etc/passwd");
			expect.unreachable("should have thrown");
		} catch (error) {
			const result = fail((error as Error).message, { id: "../etc/passwd" });
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Invalid workspace id");
		}
	});
});
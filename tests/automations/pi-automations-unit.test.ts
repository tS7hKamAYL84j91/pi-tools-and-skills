/** Automations unit tests: store paths, config, workspaces, lifecycle, formatting, tool results. */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	renderSchedulerSnapshot,
	shortCommandSummary,
	truncateText,
} from "../../extensions/pi-automations/format.js";
import {
	resolveAutomationsConfig,
	resolveAutomationsConfigForCwd,
} from "../../extensions/pi-automations/config.js";
import {
	formatAutomationsStatusSlot,
	registerAutomationsLifecycle,
} from "../../extensions/pi-automations/lifecycle.js";
import {
	assertSafeId,
	formatEnv,
	parseEnv,
	pathInside,
	slugify,
	workspaceIdFromRoom,
} from "../../extensions/pi-automations/store-paths.js";
import { automationsStatus } from "../../extensions/pi-automations/status.js";
import {
	appendWorkspaceContext,
	createWorkspace,
	readWorkspaceContext,
} from "../../extensions/pi-automations/workspaces.js";
import { ok, fail } from "../../lib/tool-result.js";
import type { CommandResult } from "../../extensions/pi-automations/types.js";

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
		const previousAutomationsHome = process.env.AUTOMATIONS_HOME;
		delete process.env.AUTOMATIONS_HOME;
		const project = join(tmpdir(), `pi-automations-base-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(project, ".pi", "automations", "workspace"), {
				recursive: true,
			});
			const config = await resolveAutomationsConfigForCwd(project);
			expect(config.automationsHome).toBe(join(project, ".pi", "automations"));
		} finally {
			if (previousAutomationsHome === undefined) {
				delete process.env.AUTOMATIONS_HOME;
			} else {
				process.env.AUTOMATIONS_HOME = previousAutomationsHome;
			}
			await rm(project, { recursive: true, force: true });
		}
	});

	it("resolves Automations_HOME from an override cwd", async () => {
		const previousAutomationsHome = process.env.AUTOMATIONS_HOME;
		delete process.env.AUTOMATIONS_HOME;
		const base = join(
			tmpdir(),
			`pi-automations-base-override-${process.pid}-${Date.now()}`,
		);
		const other = join(tmpdir(), `pi-automations-other-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(base, ".pi", "automations", "workspace"), { recursive: true });
			await mkdir(join(other, ".pi", "automations", "workspace"), { recursive: true });
			const config = await resolveAutomationsConfigForCwd(base, other);
			expect(config.automationsHome).toBe(join(other, ".pi", "automations"));
		} finally {
			if (previousAutomationsHome === undefined) {
				delete process.env.AUTOMATIONS_HOME;
			} else {
				process.env.AUTOMATIONS_HOME = previousAutomationsHome;
			}
			await rm(base, { recursive: true, force: true });
			await rm(other, { recursive: true, force: true });
		}
	});

	it("rejects a non-existent override cwd", async () => {
		const previousAutomationsHome = process.env.AUTOMATIONS_HOME;
		delete process.env.AUTOMATIONS_HOME;
		const missing = join(
			tmpdir(),
			`pi-automations-missing-${process.pid}-${Date.now()}`,
		);
		try {
			await expect(
				resolveAutomationsConfigForCwd(process.cwd(), missing),
			).rejects.toThrow(/No such directory/);
		} finally {
			if (previousAutomationsHome === undefined) {
				delete process.env.AUTOMATIONS_HOME;
			} else {
				process.env.AUTOMATIONS_HOME = previousAutomationsHome;
			}
		}
	});

	it("rejects an override cwd without a Automations runtime", async () => {
		const previousAutomationsHome = process.env.AUTOMATIONS_HOME;
		delete process.env.AUTOMATIONS_HOME;
		const base = join(
			tmpdir(),
			`pi-automations-base-no-runtime-${process.pid}-${Date.now()}`,
		);
		const empty = join(tmpdir(), `pi-automations-empty-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(base, ".pi", "automations", "workspace"), { recursive: true });
			await mkdir(empty, { recursive: true });
			await expect(resolveAutomationsConfigForCwd(base, empty)).rejects.toThrow(
				/No Automations runtime found under/,
			);
		} finally {
			if (previousAutomationsHome === undefined) {
				delete process.env.AUTOMATIONS_HOME;
			} else {
				process.env.AUTOMATIONS_HOME = previousAutomationsHome;
			}
			await rm(base, { recursive: true, force: true });
			await rm(empty, { recursive: true, force: true });
		}
	});

	it("rejects an override cwd that is a file", async () => {
		const previousAutomationsHome = process.env.AUTOMATIONS_HOME;
		delete process.env.AUTOMATIONS_HOME;
		const base = join(
			tmpdir(),
			`pi-automations-base-file-${process.pid}-${Date.now()}`,
		);
		const file = join(tmpdir(), `pi-automations-file-${process.pid}-${Date.now()}`);
		try {
			await mkdir(join(base, ".pi", "automations", "workspace"), { recursive: true });
			await writeFile(file, "not a directory", "utf8");
			await expect(resolveAutomationsConfigForCwd(base, file)).rejects.toThrow(
				/No such directory/,
			);
		} finally {
			if (previousAutomationsHome === undefined) {
				delete process.env.AUTOMATIONS_HOME;
			} else {
				process.env.AUTOMATIONS_HOME = previousAutomationsHome;
			}
			await rm(base, { recursive: true, force: true });
			await rm(file, { recursive: true, force: true });
		}
	});
});

describe("workspaces", () => {
	it("prefers project-local singular workspace root before global fallback", async () => {
		const previousAutomationsHome = process.env.AUTOMATIONS_HOME;
		delete process.env.AUTOMATIONS_HOME;
		const project = join(
			tmpdir(),
			`pi-automations-project-${process.pid}-${Date.now()}`,
		);
		const nested = join(project, "repo", "subdir");
		const workspaceDir = join(
			project,
			"repo",
			".pi",
			"automations",
			"workspace",
			"local",
		);
		try {
			await mkdir(nested, { recursive: true });
			await mkdir(workspaceDir, { recursive: true });
			await writeFile(join(workspaceDir, "CONTEXT.md"), "# Local\n", "utf8");

			const config = resolveAutomationsConfig(nested);

			expect(config.automationsHome).toBe(join(project, "repo", ".pi", "automations"));
		} finally {
			if (previousAutomationsHome === undefined) {
				delete process.env.AUTOMATIONS_HOME;
			} else {
				process.env.AUTOMATIONS_HOME = previousAutomationsHome;
			}
			await rm(project, { recursive: true, force: true });
		}
	});

	it("returns summary metadata by default instead of full context", async () => {
		const automationsHome = join(
			tmpdir(),
			`pi-automations-summary-${process.pid}-${Date.now()}`,
		);
		try {
			await createWorkspace(
				{ automationsHome },
				{ room: "general", workspace: "alpha" },
			);
			const contextPath = join(automationsHome, "workspace", "alpha", "CONTEXT.md");
			await writeFile(
				contextPath,
				`# Alpha\n\n## Stable Memory\n\nsmall fact\n\n## Private Detail\n\n${"x".repeat(20 * 1024)}\n`,
				"utf8",
			);

			const result = await readWorkspaceContext(
				{ automationsHome },
				"alpha",
				automationsHome,
			);

			expect(result.mode).toBe("summary");
			expect(result.text).toContain("Size:");
			expect(result.text).toContain("## Stable Memory");
			expect(result.text.length).toBeLessThan(13 * 1024);
			expect(result.text).not.toContain("x".repeat(13 * 1024));
		} finally {
			await rm(automationsHome, { recursive: true, force: true });
		}
	});

	it("guards full and section reads for oversized context files", async () => {
		const automationsHome = join(
			tmpdir(),
			`pi-automations-guard-${process.pid}-${Date.now()}`,
		);
		try {
			await createWorkspace(
				{ automationsHome },
				{ room: "general", workspace: "alpha" },
			);
			await writeFile(
				join(automationsHome, "workspace", "alpha", "CONTEXT.md"),
				`# Alpha\n\n${"x".repeat(130 * 1024)}\n`,
				"utf8",
			);

			await expect(
				readWorkspaceContext({ automationsHome }, "alpha", automationsHome, { mode: "full" }),
			).rejects.toThrow(/full reads are limited/);
			await expect(
				readWorkspaceContext({ automationsHome }, "alpha", automationsHome, {
					mode: "section",
					section: "Alpha",
				}),
			).rejects.toThrow(/section reads are limited/);
		} finally {
			await rm(automationsHome, { recursive: true, force: true });
		}
	});

	it("compacts oversized active context and archives the previous content", async () => {
		const automationsHome = join(
			tmpdir(),
			`pi-automations-compact-${process.pid}-${Date.now()}`,
		);
		try {
			await createWorkspace(
				{ automationsHome },
				{ room: "general", workspace: "alpha" },
			);
			const workspaceDir = join(automationsHome, "workspace", "alpha");
			await writeFile(
				join(workspaceDir, "CONTEXT.md"),
				`# Alpha\n\n${"old detail\n".repeat(9000)}`,
				"utf8",
			);

			const result = await appendWorkspaceContext(
				{ automationsHome },
				"alpha",
				automationsHome,
				"new stable fact",
			);
			const active = await readFile(result.path, "utf8");

			expect(active).toContain("# Automations Workspace Context (SPR)");
			expect(active).toContain("new stable fact");
			expect(active.length).toBeLessThan(4096);
			expect(existsSync(join(workspaceDir, "archive"))).toBe(true);
		} finally {
			await rm(automationsHome, { recursive: true, force: true });
		}
	});
});

describe("lifecycle", () => {
	it("awaits scheduler stop before clearing shutdown status", async () => {
		let releaseStop: (() => void) | undefined;
		const stopPending = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		const handlers = new Map<
			string,
			(
				event: unknown,
				ctx: {
					ui: { setStatus: (key: string, value: string | undefined) => void };
				},
			) => Promise<unknown>
		>();
		const setStatus = vi.fn();
		const stop = vi.fn(() => stopPending);
		registerAutomationsLifecycle(
			{
				on(
					event: string,
					handler: (
						event: unknown,
						ctx: {
							ui: {
								setStatus: (key: string, value: string | undefined) => void;
							};
						},
					) => Promise<unknown>,
				) {
					handlers.set(event, handler);
				},
			} as never,
			{ stop } as never,
		);
		const shutdown = handlers.get("session_shutdown");
		if (!shutdown)
			throw new Error("session_shutdown handler was not registered");

		const shutdownPending = shutdown({}, { ui: { setStatus } });
		await Promise.resolve();
		expect(stop).toHaveBeenCalledOnce();
		expect(setStatus).not.toHaveBeenCalled();

		releaseStop?.();
		await shutdownPending;
		expect(setStatus).toHaveBeenCalledWith("automations", undefined);
	});

	describe("formatAutomationsStatusSlot", () => {
		it("uses extension-prefixed status text", () => {
			expect(formatAutomationsStatusSlot()).toBe("automations: on ✓");
		});

		it("keeps workspace context after the extension prefix", () => {
			expect(formatAutomationsStatusSlot("room-general")).toBe("automations: room-general");
		});

		it("includes scheduler health and active run counts when available", () => {
			expect(
				formatAutomationsStatusSlot("exec-office", {
					running: true,
					enabledSchedules: 3,
					activeRuns: 1,
					startedAt: "2026-01-01T00:00:00Z",
				}),
			).toBe("automations: exec-office ✓ sch 3/1");
		});

		it("marks scheduler errors without using personality metaphors", () => {
			expect(
				formatAutomationsStatusSlot(undefined, {
					running: true,
					enabledSchedules: 0,
					activeRuns: 0,
					startedAt: "2026-01-01T00:00:00Z",
					lastError: "boom",
				}),
			).toBe("automations: on ⚠");
		});

		it("includes queued telemetry in compact TUI status", () => {
			expect(
				formatAutomationsStatusSlot("exec-office", {
					running: true,
					enabledSchedules: 3,
					activeRuns: 1,
					startedAt: "2026-01-01T00:00:00Z",
					queued: 2,
				}),
			).toBe("automations: exec-office ✓ sch 3/1 q2");
		});

		it("includes failed telemetry only when non-zero", () => {
			expect(
				formatAutomationsStatusSlot(undefined, {
					running: true,
					enabledSchedules: 1,
					activeRuns: 0,
					startedAt: "2026-01-01T00:00:00Z",
					queued: 1,
					failed: 1,
				}),
			).toBe("automations: on ✓ sch 1/0 q1 f1");
		});
	});

	describe("automationsStatus", () => {
		it("discloses telemetry fields when scheduler snapshot includes them", async () => {
			const automationsHome = join(
				tmpdir(),
				`pi-automations-status-telemetry-${process.pid}-${Date.now()}`,
			);
			try {
				await mkdir(join(automationsHome, "schedules"), { recursive: true });
				const result = await automationsStatus(
					{ automationsHome },
					{
						running: true,
						enabledSchedules: 0,
						activeRuns: 0,
						queued: 3,
						failed: 1,
						lastQueuedAt: "2026-01-05T09:00:00Z",
						lastFailedAt: "2026-01-05T09:01:00Z",
						lastTaskId: "daily",
					},
				);

				expect(result.stdout).toContain("queued             3");
				expect(result.stdout).toContain("failed             1");
				expect(result.stdout).toContain(
					"last queued        2026-01-05T09:00:00Z",
				);
				expect(result.stdout).toContain(
					"last failed        2026-01-05T09:01:00Z",
				);
				expect(result.stdout).toContain("last task          daily");
			} finally {
				await rm(automationsHome, { recursive: true, force: true });
			}
		});

		it("omits telemetry fields when scheduler snapshot is absent", async () => {
			const automationsHome = join(
				tmpdir(),
				`pi-automations-status-no-telemetry-${process.pid}-${Date.now()}`,
			);
			try {
				await mkdir(join(automationsHome, "schedules"), { recursive: true });
				const result = await automationsStatus({ automationsHome });

				expect(result.stdout).not.toContain("queued");
				expect(result.stdout).not.toContain("failed");
				expect(result.stdout).not.toContain("last queued");
				expect(result.stdout).not.toContain("last failed");
				expect(result.stdout).not.toContain("last task");
			} finally {
				await rm(automationsHome, { recursive: true, force: true });
			}
		});
	});
});

describe("format", () => {
	describe("shortCommandSummary", () => {
		it("shows exit code and limited lines", () => {
			const result: CommandResult = {
				code: 0,
				stdout: ["a", "b", "c", "d", "e"].join("\n"),
				stderr: "",
			};
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

describe("tool-result error paths", () => {
	it("ok result is not an error", () => {
		const result = ok("success", { code: 0 });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toBe("success");
	});

	it("fail result is an error", () => {
		const result = fail(
			"No workspace selected and cwd is not a Automations workspace",
		);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("No workspace selected");
	});

	it("fail result includes details", () => {
		const result = fail("Schedule already exists: daily-check", {
			taskId: "daily-check",
		});
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ taskId: "daily-check" });
	});

	it("fail result for empty context update", () => {
		const result = fail("Context update text must not be empty", {
			textLength: 0,
		});
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

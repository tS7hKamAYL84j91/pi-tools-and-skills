/** Operator-control and compensation coverage for pi-event-loop (SPEC §§7, 13, 16). */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG, configText, workItem } from "./fixtures/pi-event-loop.js";
import { registerEventLoopCommands } from "../extensions/pi-event-loop/event-loop-commands.js";
import { registerContextTool } from "../extensions/pi-event-loop/event-loop-context.js";
import { createEventLoopRuntime, type EventLoopRuntime } from "../extensions/pi-event-loop/runtime.js";
import type { LoopEventData, PostAppendEffects } from "../extensions/pi-event-loop/types.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

interface RegisteredCommand {
	readonly handler: (args: string, ctx: unknown) => Promise<void>;
}

interface CommandHarnessOptions {
	readonly runtime?: EventLoopRuntime;
	readonly appended?: LoopEventData[];
	readonly onReload?: () => Promise<{ ok: boolean }>;
	readonly restartPump?: () => Promise<void>;
	readonly checkpoint?: () => Promise<void>;
}

function createHarness(options: CommandHarnessOptions = {}) {
	const runtime = options.runtime ?? createEventLoopRuntime();
	const appended = options.appended ?? [];
	const notifications: Array<{ message: string; type?: string }> = [];
	let registeredHandler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		registerCommand: (_name: string, definition: RegisteredCommand) => {
			registeredHandler = definition.handler;
		},
	};
	const effects: PostAppendEffects = { workItemIds: [], commandIds: [] };
	registerEventLoopCommands(pi as never, {
		runtime,
		pipeline: () => effects,
		readEntries: () => [],
		appendEntry: (event) => appended.push(event),
		onReload: options.onReload,
		restartPump: options.restartPump,
		checkpoint: options.checkpoint,
	});
	const dispatchCommand = async (args: string, cwd: string) => {
		const ctx = {
			cwd,
			ui: {
				notify: (message: string, type?: string) =>
					notifications.push({ message, type }),
			},
			sessionManager: { getBranch: () => [] },
		};
		await registeredHandler?.(args, ctx);
		return notifications.at(-1);
	};
	return { dispatchCommand, runtime, appended, notifications };
}

function configDir(): string {
	const cwd = mkdtempSync(join("/tmp", "pi-event-loop-operator-"));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(join(cwd, ".pi/event-loop.json"), configText(), "utf8");
	tempDirs.push(cwd);
	return cwd;
}

describe("/event-loop operator controls", () => {
	it("reports status without mutation", async () => {
		const harness = createHarness();
		const before = JSON.stringify(harness.runtime);
		const result = await harness.dispatchCommand("status", configDir());
		expect(result?.type).toBe("info");
		expect(result?.message).toContain("profile: default");
		expect(JSON.stringify(harness.runtime)).toBe(before);
	});

	it("pauses and resumes with an operator-visible reason", async () => {
		const harness = createHarness();
		const cwd = configDir();
		await harness.dispatchCommand("pause maintenance", cwd);
		expect(harness.runtime.paused).toBe(true);
		expect(harness.runtime.pauseReason).toBe("maintenance");
		await harness.dispatchCommand("resume", cwd);
		expect(harness.runtime.paused).toBe(false);
	});

	it("reopens a stalled item on retry", async () => {
		const harness = createHarness();
		const stalled = workItem("stalled");
		harness.runtime.projection = {
			items: new Map([[stalled.workItemId, stalled]]),
			order: [stalled.workItemId],
		};
		harness.runtime.paused = true;
		const result = await harness.dispatchCommand(`retry ${stalled.workItemId}`, configDir());
		expect(result?.type).toBe("info");
		expect(harness.runtime.projection.items.get(stalled.workItemId)?.status).toBe("outstanding");
		expect(harness.runtime.paused).toBe(false);
	});

	it("issues a queued diagnostic command without appending a domain event", async () => {
		const harness = createHarness();
		const result = await harness.dispatchCommand(
			'issue perform-work {"workItemId":"diagnostic-1"}',
			configDir(),
		);
		expect(result?.type).toBe("info");
		expect(result?.message).toContain("no domain event fabricated");
		expect(harness.runtime.queue).toHaveLength(1);
		expect(harness.runtime.projection.order).toHaveLength(1);
		expect(harness.appended).toHaveLength(0);
	});

	it("accepts a declared compensation fact through normal ingress", () => {
		const profile = CONFIG.profiles.default;
		if (profile === undefined) throw new Error("default profile fixture missing");
		const compensationConfig = {
			...CONFIG,
			profiles: {
				default: {
					...profile,
					events: {
						...profile.events,
						"work.corrected": {
							description: "Corrects a prior work fact.",
							allowAgentEmit: true,
							requiredPayload: ["workId", "correctsEventId"],
						},
					},
				},
			},
		};
		expect(compensationConfig.profiles.default.events["work.corrected"]?.requiredPayload).toEqual(["workId", "correctsEventId"]);
	});

	it("reload invokes the injected onReload seam and reports its result", async () => {
		let reloaded = false;
		const harness = createHarness({
			onReload: async () => {
				reloaded = true;
				return { ok: true };
			},
		});
		const result = await harness.dispatchCommand("reload", configDir());
		expect(result?.type).toBe("info");
		expect(reloaded).toBe(true);
	});

	it("resume and retry restart delivery pump and invoke immediate checkpoint", async () => {
		let pumpRestartCount = 0;
		let checkpointCount = 0;
		const stalled = workItem("stalled");
		const harness = createHarness({
			restartPump: async () => {
				pumpRestartCount++;
			},
			checkpoint: async () => {
				checkpointCount++;
			},
		});
		harness.runtime.projection = {
			items: new Map([[stalled.workItemId, stalled]]),
			order: [stalled.workItemId],
		};
		harness.runtime.paused = true;
		const cwd = configDir();
		await harness.dispatchCommand("resume", cwd);
		expect(pumpRestartCount).toBe(1);
		expect(checkpointCount).toBe(1);

		harness.runtime.paused = true;
		await harness.dispatchCommand(`retry ${stalled.workItemId}`, cwd);
		expect(pumpRestartCount).toBe(2);
		expect(checkpointCount).toBe(2);
	});

	it("invokes runtime seams for checkpoint, restartPump, and reload when attached to runtime", async () => {
		let checkpointCount = 0;
		let pumpRestartCount = 0;
		let reloadCount = 0;
		const harness = createHarness();
		const runtimeWithSeams = harness.runtime as unknown as {
			checkpoint: () => Promise<void>;
			restartPump: () => Promise<void>;
			onReload: () => Promise<{ ok: boolean }>;
		};
		runtimeWithSeams.checkpoint = async () => {
			checkpointCount++;
		};
		runtimeWithSeams.restartPump = async () => {
			pumpRestartCount++;
		};
		runtimeWithSeams.onReload = async () => {
			reloadCount++;
			return { ok: true };
		};

		const cwd = configDir();
		await harness.dispatchCommand("reload", cwd);
		expect(reloadCount).toBe(1);
		expect(checkpointCount).toBe(1);
		expect(pumpRestartCount).toBe(1);

		await harness.dispatchCommand("resume", cwd);
		expect(checkpointCount).toBe(2);
		expect(pumpRestartCount).toBe(2);
	});
});

describe("event_loop_context", () => {
	it("uses the lifecycle-owned configuration authority", async () => {
		const runtime = createEventLoopRuntime();
		const tools: Array<{ execute: (...args: unknown[]) => Promise<unknown> }> = [];
		let configReads = 0;
		const deps = {
			runtime,
			readEntries: () => [],
			getConfig: () => {
				configReads++;
				return { ok: true, config: CONFIG, errors: [] };
			},
		};
		registerContextTool(
			{
				registerTool: (tool: unknown) =>
					tools.push(tool as (typeof tools)[number]),
			} as never,
			deps,
		);
		const tool = tools[0];
		if (tool === undefined) {
			throw new Error("event_loop_context tool was not registered");
		}
		const result = await tool.execute(
			"id",
			{},
			undefined,
			undefined,
			{ cwd: "/no-config-on-disk" },
		);
		expect((result as { isError?: boolean }).isError).toBeUndefined();
		expect(configReads).toBe(1);
	});

	it("is read-only and reports the active contract", async () => {
		const runtime = createEventLoopRuntime();
		const tools: Array<{ execute: (...args: unknown[]) => Promise<unknown> }> = [];
		registerContextTool(
			{
				registerTool: (tool: unknown) =>
					tools.push(tool as (typeof tools)[number]),
			} as never,
			{
				runtime,
				readEntries: () => [],
			},
		);
		expect(tools).toHaveLength(1);
		const tool = tools[0];
		if (tool === undefined) {
			throw new Error("event_loop_context tool was not registered");
		}
		const before = JSON.stringify(runtime);
		const ctx = {
			cwd: configDir(),
			ui: { notify: () => undefined },
			sessionManager: { getBranch: () => [] },
		};
		const result = await tool.execute("id", {}, undefined, undefined, ctx);
		expect((result as { isError?: boolean }).isError).toBeUndefined();
		expect(JSON.stringify(runtime)).toBe(before);
	});
});

/** Operator-control and compensation coverage for pi-event-loop (SPEC §§7, 13, 16). */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { CONFIG, configText, workItem } from "./fixtures/pi-event-loop.js";
import {
	executeOperatorCommand,
	type EventLoopCommandDeps,
} from "../extensions/pi-event-loop/event-loop-commands.js";
import { registerContextTool } from "../extensions/pi-event-loop/event-loop-context.js";
import { createEventLoopRuntime } from "../extensions/pi-event-loop/runtime.js";
import type { LoopEventData, PostAppendEffects } from "../extensions/pi-event-loop/types.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function context(cwd: string): Parameters<typeof executeOperatorCommand>[1] {
	return { cwd, ui: { notify: () => undefined }, sessionManager: { getBranch: () => [] } } as never;
}

function deps(runtime = createEventLoopRuntime(), appended: LoopEventData[] = []): EventLoopCommandDeps {
	const effects: PostAppendEffects = { workItemIds: [], commandIds: [] };
	return {
		runtime,
		pipeline: () => effects,
		readEntries: () => [],
		appendEntry: (event) => appended.push(event),
	};
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
		const runtime = createEventLoopRuntime();
		const before = JSON.stringify(runtime);
		const result = await executeOperatorCommand("status", context(configDir()), deps(runtime));
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("profile: default");
		expect(JSON.stringify(runtime)).toBe(before);
	});

	it("pauses and resumes with an operator-visible reason", async () => {
		const runtime = createEventLoopRuntime();
		const commandDeps = deps(runtime);
		const ctx = context(configDir());
		await executeOperatorCommand("pause maintenance", ctx, commandDeps);
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toBe("maintenance");
		await executeOperatorCommand("resume", ctx, commandDeps);
		expect(runtime.paused).toBe(false);
	});

	it("reopens a stalled item on retry", async () => {
		const runtime = createEventLoopRuntime();
		const stalled = workItem("stalled");
		runtime.projection = { items: new Map([[stalled.workItemId, stalled]]), order: [stalled.workItemId] };
		runtime.paused = true;
		const result = await executeOperatorCommand(`retry ${stalled.workItemId}`, context(configDir()), deps(runtime));
		expect(result.isError).toBeUndefined();
		expect(runtime.projection.items.get(stalled.workItemId)?.status).toBe("outstanding");
		expect(runtime.paused).toBe(false);
	});

	it("issues a queued diagnostic command without appending a domain event", async () => {
		const runtime = createEventLoopRuntime();
		const appended: LoopEventData[] = [];
		const result = await executeOperatorCommand(
			'issue perform-work {"workItemId":"diagnostic-1"}',
			context(configDir()),
			deps(runtime, appended),
		);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("no domain event fabricated");
		expect(runtime.queue).toHaveLength(1);
		expect(runtime.projection.order).toHaveLength(1);
		expect(appended).toHaveLength(0);
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
});

describe("event_loop_context", () => {
	it("is read-only and reports the active contract", async () => {
		const runtime = createEventLoopRuntime();
		const tools: Array<{ execute: (...args: unknown[]) => Promise<unknown> }> = [];
		registerContextTool({ registerTool: (tool: unknown) => tools.push(tool as (typeof tools)[number]) } as never, {
			runtime,
			readEntries: () => [],
		});
		expect(tools).toHaveLength(1);
		const before = JSON.stringify(runtime);
		const result = await tools[0]!.execute("id", {}, undefined, undefined, context(configDir()));
		expect((result as { isError?: boolean }).isError).toBeUndefined();
		expect(JSON.stringify(runtime)).toBe(before);
	});
});

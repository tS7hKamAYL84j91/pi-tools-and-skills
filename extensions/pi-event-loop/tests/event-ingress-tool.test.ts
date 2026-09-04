/** Tests for the event_loop_emit tool wiring over the ingress decision logic (SPEC §7). */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ToolResult } from "../../../lib/tool-result.js";
import { createEmitTool } from "../event-ingress-tool.js";
import { evaluateEmission, type EmissionContext } from "../event-ingress.js";
import { createEventLoopRuntime, type EventLoopRuntime } from "../runtime.js";
import type { LoopEventData, PostAppendPipeline } from "../types.js";
import { CONFIG } from "../../../tests/fixtures/pi-event-loop.js";

interface ToolCall {
	readonly customType: string;
	readonly data: unknown;
}

type EmitTool = ReturnType<typeof createEmitTool>;

/**
 * Tool executes return lib ToolResult objects; the extension-level AgentToolResult type
 * erases the isError flag, so tests cast the execute result back to ToolResult.
 */
async function runTool(
	tool: EmitTool,
	params: {
		event: string;
		dedupeKey: string;
		payload?: Record<string, unknown>;
	},
	ctx: ExtensionContext,
): Promise<ToolResult> {
	return (await tool.execute(
		"t1",
		params,
		undefined,
		undefined,
		ctx,
	)) as ToolResult;
}

function makeDeps(
	runtime: EventLoopRuntime,
	calls: ToolCall[],
	pipeline?: PostAppendPipeline,
) {
	return {
		appendEntry: (customType: string, data?: unknown) => {
			(calls as ToolCall[]).push({ customType, data: data ?? null });
		},
		runtime,
		loadConfig: async () => ({
			ok: true,
			config: CONFIG,
			fingerprint: "fp",
			errors: [],
		}),
		pipeline,
	};
}

function emissionContext(knownEventIds: readonly string[] = []): EmissionContext {
	return {
		config: CONFIG,
		profileName: "default",
		source: "operator",
		activeCommand: undefined,
		activeWorkItem: undefined,
		knownEventIds: new Set(knownEventIds),
		now: () => "2026-09-04T15:00:00Z",
	};
}

function fakeCtx(branch: readonly LoopEventData[]) {
	const entries = branch.map((event) => ({
		type: "custom",
		customType: "pi-event-loop-event",
		data: event,
	}));
	return {
		cwd: "/tmp/project",
		sessionManager: {
			getBranch: () => entries,
		},
	} as unknown as Parameters<ReturnType<typeof createEmitTool>["execute"]>[4];
}

describe("event_loop_emit tool", () => {
	it("appends the event before pipeline effects and returns resulting ids", async () => {
		const calls: ToolCall[] = [];
		const observed: string[] = [];
		const pipeline: PostAppendPipeline = (event) => {
			observed.push(event.eventId);
			return { workItemIds: ["item-9"], commandIds: ["cmd-9"] };
		};
		const tool = createEmitTool(
			makeDeps(createEventLoopRuntime(), calls, pipeline),
		);
		const result = await runTool(
			tool,
			{ event: "progress.note", dedupeKey: "n9", payload: {} },
			fakeCtx([]),
		);
		expect(result.isError).toBeUndefined();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.customType).toBe("pi-event-loop-event");
		expect(observed).toEqual([
			calls[0] !== undefined ? (calls[0].data as LoopEventData).eventId : "",
		]);
		expect(result.details["commandIds"]).toEqual(["cmd-9"]);
		expect(result.details["workItemIds"]).toEqual(["item-9"]);
	});

	it("skips append and pipeline for duplicate submissions", async () => {
		const calls: ToolCall[] = [];
		const existing = evaluateEmission(emissionContext(), {
			event: "progress.note",
			dedupeKey: "dup",
			payload: {},
		});
		expect(existing.ok).toBe(true);
		const runtime = createEventLoopRuntime();
		const tool = createEmitTool(makeDeps(runtime, calls));
		const result = await runTool(
			tool,
			{ event: "progress.note", dedupeKey: "dup", payload: {} },
			fakeCtx(existing.ok ? [existing.event] : []),
		);
		expect(calls).toHaveLength(0);
		expect(result.details["duplicate"]).toBe(true);
	});

	it("rejects invalid events before append", async () => {
		const calls: ToolCall[] = [];
		const tool = createEmitTool(makeDeps(createEventLoopRuntime(), calls));
		const result = await runTool(
			tool,
			{ event: "unknown.event", dedupeKey: "x", payload: {} },
			fakeCtx([]),
		);
		expect(result.isError).toBe(true);
		expect(calls).toHaveLength(0);
		expect(String(result.content[0]?.text ?? "")).toContain("event rejected");
	});

	it("fails cleanly when configuration is missing", async () => {
		const calls: ToolCall[] = [];
		const deps = {
			...makeDeps(createEventLoopRuntime(), calls),
			loadConfig: async () => ({ ok: false, missing: true, errors: [] }),
		};
		const tool = createEmitTool(deps);
		const result = await runTool(
			tool,
			{ event: "progress.note", dedupeKey: "x", payload: {} },
			fakeCtx([]),
		);
		expect(result.isError).toBe(true);
		expect(String(result.content[0]?.text ?? "")).toContain("not usable");
		expect(calls).toHaveLength(0);
	});
});

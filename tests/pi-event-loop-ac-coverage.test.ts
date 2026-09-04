/** Acceptance-criteria coverage for P1-P4 edges not reached by the extension's own suites (SPEC §20). */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPostAppendPipeline } from "../extensions/pi-event-loop/automator.js";
import { parseEventLoopConfig } from "../extensions/pi-event-loop/config.js";
import {
	deliverNextCommand,
	settleActiveCommand,
} from "../extensions/pi-event-loop/dispatcher.js";
import { buildDescriptionFromProfile } from "../extensions/pi-event-loop/event-ingress-tool.js";
import { createEventLoopRuntime } from "../extensions/pi-event-loop/runtime.js";
import { COMMAND_MESSAGE_CUSTOM_TYPE } from "../extensions/pi-event-loop/types.js";
import {
	CONFIG,
	configText,
	fixtureObject,
	workCompleted,
	workRequested,
} from "./fixtures/pi-event-loop.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

/** Write a configuration file into a temp project directory; returns the directory. */
function tempProjectDir(configJson: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-event-loop-ac-"));
	tempDirs.push(dir);
	mkdirSync(join(dir, ".pi"));
	writeFileSync(join(dir, ".pi/event-loop.json"), configJson);
	return dir;
}

describe("emit tool description contract (AC-11)", () => {
	it("generated description exposes agent-emittable events, payload and command contract", () => {
		const raw = JSON.parse(configText()) as Record<string, unknown>;
		const profiles = fixtureObject(raw, "profiles");
		const profile = fixtureObject(profiles, "default");
		const events = fixtureObject(profile, "events");
		events["progress.note"] = {
			description: "A free observation.",
			allowAgentEmit: true,
			requiredPayload: [],
			allowWithoutCommand: true,
		};
		const description = buildDescriptionFromProfile(
			tempProjectDir(JSON.stringify(raw, null, "\t")),
		);
		expect(description).toContain("Events you may emit:");
		expect(description).toContain(
			"- work.completed: The requested work completed successfully.",
		);
		expect(description).toContain("Required payload: workId, resultPath.");
		expect(description).toContain(
			"- progress.note: A free observation. Required payload: none. (also allowed without an active command)",
		);
		expect(description).not.toContain("- work.requested");
		expect(description).toContain(
			"During an active command turn you may only emit that command's expected events",
		);
	});
	it("falls back to the static contract when the configuration is unreadable", () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "pi-event-loop-ac-"));
		tempDirs.push(emptyDir);
		const fallback = buildDescriptionFromProfile(emptyDir);
		expect(fallback).not.toContain("Events you may emit:");
		expect(fallback).toContain("allowWithoutCommand");
		expect(fallback).toContain("event_loop_context");
	});
});

describe("configuration fingerprint (AC-19 detection part)", () => {
	it("is deterministic for identical text and changes with the document", () => {
		const first = parseEventLoopConfig(configText());
		const again = parseEventLoopConfig(configText());
		expect(first.ok).toBe(true);
		expect(first.fingerprint).toBe(again.fingerprint);
		expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);

		const variant = parseEventLoopConfig(
			configText({ limits: { ...CONFIG.limits, maxPendingCommands: 19 } }),
		);
		expect(variant.ok).toBe(true);
		expect(variant.fingerprint).not.toBe(first.fingerprint);
	});
});

describe("runtime instance independence (AC-23)", () => {
	it("two sessions keep independent projections, queues and deliveries", async () => {
		const sessionA = createEventLoopRuntime();
		const sessionB = createEventLoopRuntime();

		createPostAppendPipeline(sessionA)(
			workRequested("work-1"),
			CONFIG,
			"default",
		);
		expect(sessionA.projection.items.size).toBe(1);
		expect(sessionB.projection.items.size).toBe(0);
		expect(sessionB.queue).toHaveLength(0);

		const delivered: string[] = [];
		const outcome = await deliverNextCommand(
			{
				sendMessage: async (message) => void delivered.push(message.customType),
			},
			sessionA,
		);
		expect(outcome.delivered).toBe(true);
		expect(delivered).toEqual([COMMAND_MESSAGE_CUSTOM_TYPE]);
		expect(sessionB.activeCommand).toBeUndefined();
		expect(sessionB.paused).toBe(false);
	});
});

describe("sequential command delivery (AC-13)", () => {
	it("delivers queued commands one at a time with a single active command", async () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		pipeline(workRequested("work-1"), CONFIG, "default");
		pipeline(workRequested("work-2"), CONFIG, "default");
		expect(runtime.queue).toHaveLength(2);

		const delivered: string[] = [];
		const deliver = (): ReturnType<typeof deliverNextCommand> =>
			deliverNextCommand(
				{
					sendMessage: async (message) =>
						void delivered.push(message.customType),
				},
				runtime,
			);

		expect((await deliver()).delivered).toBe(true);
		expect(runtime.queue).toHaveLength(1);

		const refused = await deliver();
		expect(refused.delivered).toBe(false);
		expect(refused.reason).toContain("already active");

		pipeline(workCompleted("work-1"), CONFIG, "default");
		expect(settleActiveCommand(runtime, true)).toEqual({
			settled: true,
			stalled: false,
		});
		expect((await deliver()).delivered).toBe(true);
		expect(delivered).toEqual([
			COMMAND_MESSAGE_CUSTOM_TYPE,
			COMMAND_MESSAGE_CUSTOM_TYPE,
		]);
		expect(runtime.queue).toHaveLength(0);
	});
});

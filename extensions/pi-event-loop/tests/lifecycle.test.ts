/** Tests for the Pi lifecycle wiring (SPEC §17): restore, deliver, timers, checkpoints. */

import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	agentOutcome,
	configText,
	contextFor,
	createFakeEventLoopPi,
	eventEntry,
	itemIdOf,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { CONFIG_RELATIVE_PATH, parseEventLoopConfig } from "../config.js";
import eventLoopExtension from "../index.js";
import { asSnapshot } from "../snapshot-format.js";
import {
	COMMAND_MESSAGE_CUSTOM_TYPE,
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type EventLoopConfig,
	type LimitsConfig,
	type LoopEventData,
	SNAPSHOT_CUSTOM_TYPE,
} from "../types.js";

const BASE_TIME = new Date("2026-01-05T10:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(BASE_TIME);
});

const createdDirs: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const dir of createdDirs.splice(0)) {
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

function writeConfigDir(text: string): string {
	const dir = nodeFs.mkdtempSync(join(tmpdir(), "event-loop-wiring-"));
	nodeFs.mkdirSync(join(dir, ".pi"), { recursive: true });
	nodeFs.writeFileSync(join(dir, CONFIG_RELATIVE_PATH), text, "utf8");
	createdDirs.push(dir);
	return dir;
}

async function runSessionStart(fake: FakePi, cwd: string): Promise<void> {
	const handler = fake.handlers.get("session_start");
	if (handler === undefined) {
		throw new Error("session_start handler not registered");
	}
	await handler(
		{ type: "session_start", reason: "startup" },
		contextFor(fake, cwd),
	);
	await vi.advanceTimersByTimeAsync(5);
}

type Handler = (event: unknown, ctx: unknown) => unknown;

type FakePi = ReturnType<typeof createFakeEventLoopPi>;

/** Narrow the registered handler map off the shared fixture fake. */
function handlersOf(fake: FakePi): Map<string, Handler> {
	return fake.handlers;
}

function snapshots(fake: FakePi) {
	return fake.entries.filter(
		(entry) => entry.customType === SNAPSHOT_CUSTOM_TYPE,
	);
}

function lastSnapshot(fake: FakePi) {
	const entry = snapshots(fake).at(-1);
	return entry === undefined ? undefined : asSnapshot(entry.data);
}

function runShutdown(fake: FakePi): void {
	const handler = handlersOf(fake).get("session_shutdown");
	if (handler === undefined) {
		throw new Error("session_shutdown handler not registered");
	}
	handler(
		{ type: "session_shutdown", reason: "quit" },
		contextFor(fake, "/tmp"),
	);
}

describe("index lifecycle wiring (SPEC §17)", () => {
	it("session_start rebuilds from history, delivers, stalls on missing outcome, checkpoints", async () => {
		const fake = createFakeEventLoopPi();
		eventLoopExtension(fake.api);
		const cwd = writeConfigDir(configText());
		fake.entries.push(eventEntry(workRequested("work-1")));

		await runSessionStart(fake, cwd);
		expect(fake.sent).toHaveLength(1);
		const message = fake.sent[0]?.message as {
			customType: string;
			details: { commandType: string; workItemId: string };
		};
		expect(message.customType).toBe(COMMAND_MESSAGE_CUSTOM_TYPE);
		expect(message.details.commandType).toBe("perform-work");
		expect(message.details.workItemId).toBe(
			itemIdOf(workRequested("work-1"), "work-1"),
		);

		// The turn settles without an expected outcome → stall + pause.
		fake.idle = true;
		await vi.advanceTimersByTimeAsync(150);
		runShutdown(fake);
		const snapshot = lastSnapshot(fake);
		expect(snapshot?.paused).toBe(true);
		expect(snapshot?.pauseReason).toContain("missing-outcome");
		expect(snapshot?.items.some((item) => item.status === "stalled")).toBe(
			true,
		);
	});

	it("input resets the consecutive automated-turn counter for interactive input only", async () => {
		const fake = createFakeEventLoopPi();
		eventLoopExtension(fake.api);
		const limits: LimitsConfig = {
			...CONFIG_LIMITS_FIXTURE,
			maxConsecutiveTurns: 1,
		};
		const cwd = writeConfigDir(configText({ limits }));
		fake.entries.push(eventEntry(workRequested("work-1")));
		fake.entries.push(eventEntry(workRequested("work-2")));

		await runSessionStart(fake, cwd);
		expect(fake.sent).toHaveLength(1);
		const outcome = agentOutcomeFromMessage(fake.sent[0]?.message);
		fake.entries.push(eventEntry(outcome));
		fake.idle = true;
		await vi.advanceTimersByTimeAsync(150);
		// The second command hits the turn limit instead of delivering.
		expect(fake.sent).toHaveLength(1);
		expect(fake.notify).not.toHaveBeenCalled();

		const input = handlersOf(fake).get("input");
		if (input === undefined) {
			throw new Error("input handler not registered");
		}
		input(
			{ type: "input", text: "hello", source: "interactive" },
			contextFor(fake, cwd),
		);
		input(
			{ type: "input", text: "ext", source: "extension" },
			contextFor(fake, cwd),
		);
		runShutdown(fake);
		const snapshot = lastSnapshot(fake);
		// Interactive input reset the counter; extension input did not re-reset it.
		expect(snapshot?.consecutiveAutomatedTurns).toBe(0);
		expect(snapshot?.paused).toBe(true);
		expect(snapshot?.pauseReason).toContain("turn-limit");
	});

	it("calculates timer catch-up with at most one interval occurrence (AC-17)", async () => {
		const fake = createFakeEventLoopPi();
		eventLoopExtension(fake.api);
		const timerConfig = JSON.stringify({
			version: 1,
			activeProfile: "default",
			profiles: {
				default: {
					emissionPolicy: "command-contract",
					events: {
						"progress.due": {
							description: "A periodic occurrence became due.",
							allowAgentEmit: false,
							requiredPayload: ["scheduledFor"],
						},
					},
					commands: {},
					views: {},
					automations: [],
					timers: [{ id: "tick", intervalMinutes: 1, emit: "progress.due" }],
				},
			},
		});
		const parsed = parseEventLoopConfig(timerConfig);
		if (!parsed.ok || parsed.fingerprint === undefined) {
			throw new Error("fixture broken: timer config invalid");
		}
		const cwd = writeConfigDir(timerConfig);
		// The interval timer last fired 2.5 slots ago while the session was closed.
		fake.entries.push({
			type: "custom",
			customType: SNAPSHOT_CUSTOM_TYPE,
			data: {
				schemaVersion: 1,
				profileName: "default",
				configFingerprint: parsed.fingerprint,
				projectedEventCount: 0,
				items: [],
				pendingCommands: [],
				recentEventIds: [],
				timerState: { tick: { lastIntervalFiredAt: BASE_TIME - 150_000 } },
				paused: false,
				consecutiveAutomatedTurns: 0,
			},
		});

		await runSessionStart(fake, cwd);
		const timerEvents = fake.entries.filter(
			(entry) => entry.customType === EVENT_LOOP_EVENT_CUSTOM_TYPE,
		);
		expect(timerEvents).toHaveLength(1);
		const emitted = timerEvents[0]?.data as LoopEventData;
		expect(emitted.source).toBe("timer");
		expect(emitted.type).toBe("progress.due");
		expect(emitted.payload).toEqual({
			scheduledFor: new Date(BASE_TIME - 30_000).toISOString(),
		});
	});

	it("stays inert without configuration", async () => {
		const fake = createFakeEventLoopPi();
		eventLoopExtension(fake.api);
		const emptyDir = nodeFs.mkdtempSync(join(tmpdir(), "event-loop-empty-"));
		createdDirs.push(emptyDir);
		await runSessionStart(fake, emptyDir);
		expect(fake.sent).toHaveLength(0);
		expect(fake.entries).toHaveLength(0);
		expect(fake.notify).not.toHaveBeenCalled();
		runShutdown(fake);
		expect(snapshots(fake)).toHaveLength(0);
	});

	it("registers agent_settled lifecycle hook", () => {
		const fake = createFakeEventLoopPi();
		eventLoopExtension(fake.api);
		expect(handlersOf(fake).has("agent_settled")).toBe(true);
	});

	it("delivery pump is re-entrant: empty initial cycle followed by later event delivers", async () => {
		const fake = createFakeEventLoopPi();
		const registeredTools: Array<{
			name: string;
			execute: (
				id: string,
				params: unknown,
				ext?: unknown,
				sig?: unknown,
				ctx?: unknown,
			) => Promise<unknown>;
		}> = [];
		fake.api = {
			on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				fake.handlers.set(event, handler);
			},
			registerTool: (tool: {
				name: string;
				execute: (
					id: string,
					params: unknown,
					ext?: unknown,
					sig?: unknown,
					ctx?: unknown,
				) => Promise<unknown>;
			}) => {
				registeredTools.push(tool);
			},
			registerCommand: () => undefined,
			appendEntry: (customType: string, data?: unknown) => {
				fake.entries.push({ type: "custom", customType, data: data ?? null });
			},
			sendMessage: (message: unknown, options: unknown) => {
				fake.sent.push({ message, options });
				fake.idle = false;
			},
		} as never;

		eventLoopExtension(fake.api);
		const cwd = writeConfigDir(configText());

		await runSessionStart(fake, cwd);
		expect(fake.sent).toHaveLength(0);

		// Emit an event after the initial cycle exited
		const emitTool = registeredTools.find((t) => t.name === "event_loop_emit");
		expect(emitTool).toBeDefined();

		await emitTool!.execute(
			"call-1",
			{
				event: "work.requested",
				dedupeKey: "work-reentry-1",
				payload: { workId: "work-reentry-1" },
			},
			undefined,
			undefined,
			contextFor(fake, cwd),
		);
		await vi.advanceTimersByTimeAsync(5);

		// Should deliver the command for the new item
		expect(fake.sent).toHaveLength(1);
	});
});

const CONFIG_LIMITS_FIXTURE: EventLoopConfig["limits"] = {
	maxPendingCommands: 20,
	maxOpenItemsPerView: 100,
	maxPayloadBytes: 16384,
	maxChainDepth: 12,
	maxConsecutiveTurns: 8,
	maxRecentEvents: 1000,
};

function agentOutcomeFromMessage(message: unknown): LoopEventData {
	const details = (
		message as {
			details: {
				commandId: string;
				workItemId: string;
				correlationId: string;
				expectedEvents: readonly string[];
			};
		}
	).details;
	return agentOutcome({
		type: details.expectedEvents[0] ?? "work.completed",
		payload: { workId: details.correlationId },
		commandId: details.commandId,
		workItemId: details.workItemId,
		correlationId: details.correlationId,
		occurredAt: new Date(BASE_TIME).toISOString(),
	});
}

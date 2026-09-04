/** Shared pi-event-loop test fixtures: a small default profile, config, work items, and events. */

import type {
	EventLoopConfig,
	LoopEventData,
	ProfileConfig,
	TodoItem,
} from "../../extensions/pi-event-loop/types.js";

export const PROFILE: ProfileConfig = {
	emissionPolicy: "command-contract",
	events: {
		"work.requested": {
			description: "Work requested (not agent-emittable).",
			allowAgentEmit: false,
			requiredPayload: ["workId"],
		},
		"work.completed": {
			description: "Work completed.",
			allowAgentEmit: true,
			requiredPayload: ["workId", "resultPath"],
		},
		"work.failed": {
			description: "Work failed.",
			allowAgentEmit: true,
			requiredPayload: ["workId", "reason"],
		},
		"progress.note": {
			description: "A free observation.",
			allowAgentEmit: true,
			requiredPayload: [],
			allowWithoutCommand: true,
		},
	},
	commands: {
		"perform-work": {
			message: "Perform the work.",
			expectedEvents: ["work.completed", "work.failed"],
		},
	},
	views: {
		"work-due": {
			type: "todo",
			openOn: [{ event: "work.requested", keyFrom: "/workId" }],
			closeOn: [
				{ event: "work.completed", keyFrom: "/workId" },
				{ event: "work.failed", keyFrom: "/workId" },
			],
		},
	},
	automations: [{ id: "perform", view: "work-due", issue: "perform-work" }],
	timers: [],
};

export const CONFIG: EventLoopConfig = {
	version: 1,
	activeProfile: "default",
	profiles: { default: PROFILE },
	limits: {
		maxPendingCommands: 20,
		maxOpenItemsPerView: 100,
		maxPayloadBytes: 1024,
		maxChainDepth: 12,
		maxConsecutiveTurns: 8,
		maxRecentEvents: 1000,
	},
};

/** Build a work item; defaults mirror the work-due view projection. */
export function workItem(
	status: TodoItem["status"],
	key = "work-42",
): TodoItem {
	return {
		workItemId: `item-${key}`,
		viewId: "work-due",
		key,
		openedByEventId: "evt-open",
		sourcePayload: { workId: key },
		status,
	};
}

/** Build a deterministic operator/system event (agent events carry causation via ingress). */
function event(
	type: string,
	payload: Record<string, unknown>,
	occurredAt = "2026-01-01T00:00:00.000Z",
): LoopEventData {
	return {
		eventId: `evt-${type}-${JSON.stringify(payload)}`,
		type,
		occurredAt,
		source: "operator",
		payload,
	};
}

export const workRequested = (workId: string): LoopEventData =>
	event("work.requested", { workId });
export const workCompleted = (workId: string): LoopEventData =>
	event("work.completed", { workId, resultPath: "out/x.md" });

// --- Configuration fixtures (SPEC §6 example profile; shared by config tests) ---

/** @public Reusable VALID_CONFIG fixture mirroring the SPEC §6 example profile. */
export const VALID_CONFIG: Record<string, unknown> = {
	version: 1,
	activeProfile: "default",
	profiles: {
		default: {
			emissionPolicy: "command-contract",
			events: {
				"work.requested": {
					description: "A unit of work is ready to be performed.",
					allowAgentEmit: false,
					requiredPayload: ["workId"],
				},
				"work.completed": {
					description: "The requested work completed successfully.",
					allowAgentEmit: true,
					requiredPayload: ["workId", "resultPath"],
				},
				"work.failed": {
					description: "The requested work could not be completed.",
					allowAgentEmit: true,
					requiredPayload: ["workId", "reason"],
				},
			},
			commands: {
				"perform-work": {
					message:
						"Perform the requested work described in the attached work item.",
					expectedEvents: ["work.completed", "work.failed"],
				},
			},
			views: {
				"work-due": {
					type: "todo",
					openOn: [{ event: "work.requested", keyFrom: "/workId" }],
					closeOn: [
						{ event: "work.completed", keyFrom: "/workId" },
						{ event: "work.failed", keyFrom: "/workId" },
					],
				},
			},
			automations: [
				{
					id: "perform-requested-work",
					view: "work-due",
					issue: "perform-work",
				},
			],
			timers: [{ id: "hourly", intervalMinutes: 60, emit: "work.requested" }],
		},
	},
	limits: {
		maxPendingCommands: 20,
		maxOpenItemsPerView: 100,
		maxPayloadBytes: 16384,
		maxChainDepth: 12,
		maxConsecutiveTurns: 8,
		maxRecentEvents: 1000,
	},
};

/** Serialize the shared config fixture with optional top-level overrides. */
export function configText(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({ ...VALID_CONFIG, ...overrides }, null, "\t");
}

/** Unwrap a nested fixture object, failing loudly when the fixture drifts. */
export function fixtureObject(
	parent: unknown,
	key: string,
): Record<string, unknown> {
	if (typeof parent !== "object" || parent === null) {
		throw new Error(`test fixture broken at "${key}"`);
	}
	const value: unknown = (parent as Record<string, unknown>)[key];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`test fixture broken: "${key}" is not an object`);
	}
	return value as Record<string, unknown>;
}

// --- P5/P6/P7 fixtures: timers, snapshots, fake pi wiring (SPEC §12, §15, §17) ---

import { vi } from "vitest";
import { createPostAppendPipeline } from "../../extensions/pi-event-loop/automator.js";
import { DEFAULT_LIMITS } from "../../extensions/pi-event-loop/config-limits.js";
import {
	createEventLoopRuntime,
	type EventLoopRuntime,
} from "../../extensions/pi-event-loop/runtime.js";
import {
	deriveWorkItemId,
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type EventSource,
	SNAPSHOT_CUSTOM_TYPE,
} from "../../extensions/pi-event-loop/types.js";

/** Profile for timer-source tests: occurrence facts with valid and broken contracts. */
export const TIMER_PROFILE: ProfileConfig = {
	emissionPolicy: "command-contract",
	events: {
		"progress.review-became-due": {
			description: "A periodic progress review became due.",
			allowAgentEmit: false,
			requiredPayload: ["scheduledFor"],
		},
		"progress.bad-contract": {
			description: "Requires a payload key the timer never supplies.",
			allowAgentEmit: false,
			requiredPayload: ["workId", "scheduledFor"],
		},
	},
	commands: {},
	views: {},
	automations: [],
	timers: [
		{ id: "hourly", intervalMinutes: 60, emit: "progress.review-became-due" },
		{ id: "daily", dailyAt: "09:30", emit: "progress.review-became-due" },
		{ id: "broken", intervalMinutes: 30, emit: "progress.bad-contract" },
	],
};

/** Timer limits mirroring the defaults with a small payload bound. */
export const TIMER_LIMITS: EventLoopConfig["limits"] = {
	...DEFAULT_LIMITS,
	maxPayloadBytes: 1024,
};

/** Deterministic work-item id the projector derives for a fixture request event. */
export function itemIdOf(event: LoopEventData, key: string): string {
	return deriveWorkItemId("default", "work-due", key, event.eventId);
}

/** A work item as the projector derives it for a fixture request event. */
export function projectedItem(event: LoopEventData, key: string): TodoItem {
	return {
		workItemId: itemIdOf(event, key),
		viewId: "work-due",
		key,
		openedByEventId: event.eventId,
		sourcePayload: event.payload,
		status: "outstanding",
	};
}

/** A work item as the projector derives it for a fixture request event. */
interface AgentOutcomeInput {
	readonly type: string;
	readonly payload: Record<string, unknown>;
	readonly commandId: string;
	readonly workItemId: string;
	readonly correlationId: string;
	readonly occurredAt?: string;
}

/** An agent outcome event carrying the causation metadata attached by ingress. */
export function agentOutcome(input: AgentOutcomeInput): LoopEventData {
	return {
		eventId: `evt-outcome-${input.type}-${input.correlationId}`,
		type: input.type,
		occurredAt: input.occurredAt ?? "2026-01-01T01:00:00.000Z",
		source: "agent" satisfies EventSource,
		payload: input.payload,
		commandId: input.commandId,
		workItemId: input.workItemId,
		correlationId: input.correlationId,
		causationId: input.commandId,
	};
}

/** Run the post-append pipeline over a history, mirroring the live append path. */
export function runtimeWithHistory(
	events: readonly LoopEventData[],
	config: EventLoopConfig = CONFIG,
): { runtime: EventLoopRuntime; pipeline: (event: LoopEventData) => void } {
	const runtime = createEventLoopRuntime();
	const apply = createPostAppendPipeline(runtime);
	for (const event of events) {
		apply(event, config, config.activeProfile);
	}
	return {
		runtime,
		pipeline: (event) => apply(event, config, config.activeProfile),
	};
}

/** Wrap one custom session entry (event log shape). */
export function eventEntry(event: LoopEventData): {
	type: string;
	customType: string;
	data: LoopEventData;
} {
	return {
		type: "custom",
		customType: EVENT_LOOP_EVENT_CUSTOM_TYPE,
		data: event,
	};
}

/** Wrap one custom session entry (snapshot shape). */
export function snapshotEntry(snapshot: unknown): {
	type: string;
	customType: string;
	data: unknown;
} {
	return { type: "custom", customType: SNAPSHOT_CUSTOM_TYPE, data: snapshot };
}

type Handler = (event: unknown, ctx: unknown) => unknown;

/** Minimal fake ExtensionAPI surface for lifecycle wiring tests. */
interface FakeEventLoopPi {
	readonly handlers: Map<string, Handler>;
	readonly entries: Array<{ type: string; customType: string; data: unknown }>;
	readonly sent: Array<{ message: unknown; options: unknown }>;
	readonly notify: ReturnType<typeof vi.fn>;
	/** Assigned once during construction; cast at the ExtensionAPI boundary. */
	api: never;
	idle: boolean;
}

/** Build a fake ExtensionAPI + context pair exercising the production wiring. */
export function createFakeEventLoopPi(): FakeEventLoopPi {
	const handlers = new Map<string, Handler>();
	const entries: Array<{ type: string; customType: string; data: unknown }> =
		[];
	const sent: Array<{ message: unknown; options: unknown }> = [];
	const notify = vi.fn();
	const fake: FakeEventLoopPi = {
		handlers,
		entries,
		sent,
		notify,
		api: null as never,
		idle: true,
	};
	const api = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		registerTool: (_tool: unknown) => undefined,
		registerCommand: (_name: string, _options: unknown) => undefined,
		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data: data ?? null });
		},
		sendMessage: (message: unknown, options: unknown) => {
			sent.push({ message, options });
			fake.idle = false;
		},
	};
	fake.api = api as never;
	return fake;
}

/** Extension context fake bound to a fake pi's entries and idle flag. */
export function contextFor(fake: FakeEventLoopPi, cwd: string): unknown {
	return {
		cwd,
		hasUI: true,
		mode: "tui",
		ui: { notify: fake.notify },
		sessionManager: { getBranch: () => fake.entries },
		isIdle: () => fake.idle,
		hasPendingMessages: () => false,
	};
}

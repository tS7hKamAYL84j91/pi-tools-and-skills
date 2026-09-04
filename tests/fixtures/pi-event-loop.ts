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
export function fixtureObject(parent: unknown, key: string): Record<string, unknown> {
	if (typeof parent !== "object" || parent === null) {
		throw new Error(`test fixture broken at "${key}"`);
	}
	const value: unknown = (parent as Record<string, unknown>)[key];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`test fixture broken: "${key}" is not an object`);
	}
	return value as Record<string, unknown>;
}

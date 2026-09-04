/** Focused T-895 tests: the tracked single-ticket delivery config through the production parser, projector and automator. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPostAppendPipeline } from "../extensions/pi-event-loop/automator.js";
import { parseEventLoopConfig } from "../extensions/pi-event-loop/config.js";
import {
	buildCommandMessage,
	deliverNextCommand,
	settleActiveCommand,
} from "../extensions/pi-event-loop/dispatcher.js";
import { evaluateEmission } from "../extensions/pi-event-loop/event-ingress.js";
import { eventChainDepth } from "../extensions/pi-event-loop/loop-guards.js";
import { createEventLoopRuntime } from "../extensions/pi-event-loop/runtime.js";
import {
	COMMAND_MESSAGE_CUSTOM_TYPE,
	deriveEventId,
	type CommandRecord,
	type EventLoopConfig,
	type LoopEventData,
} from "../extensions/pi-event-loop/types.js";

const CONFIG_TEXT = readFileSync(
	fileURLToPath(new URL("../examples/event-loop/ticket-delivery.json", import.meta.url)),
	"utf8",
);

const parsed = parseEventLoopConfig(CONFIG_TEXT);
if (!parsed.ok || parsed.config === undefined) {
	throw new Error("tracked ticket-delivery config must validate through the production parser");
}
const CONFIG: EventLoopConfig = parsed.config;
const PROFILE = CONFIG.profiles[CONFIG.activeProfile];
if (PROFILE === undefined) {
	throw new Error("tracked ticket-delivery config must define its active profile");
}

/** The five bounded stages in delivery order. */
const STAGES = [
	{ view: "stage-plan", success: "ticket.planned", command: "plan-ticket" },
	{
		view: "stage-implement",
		success: "ticket.implemented",
		command: "implement-ticket",
	},
	{ view: "stage-verify", success: "ticket.verified", command: "verify-ticket" },
	{
		view: "stage-release",
		success: "ticket.pushed",
		command: "release-ticket",
	},
	{
		view: "stage-complete",
		success: "ticket.completed",
		command: "complete-ticket",
	},
] as const;

const TERMINAL_EVENTS = ["stage.blocked", "stage.waiting", "stage.failed"] as const;
const TICKET_ID = "T-886";
const RUN_ID = "t886-test-run";

/** Compound correlation key: the view correlation key is correlation='<ticketId>:<runId>'. */
function correlationFor(runId = RUN_ID, ticketId = TICKET_ID): string {
	return `${ticketId}:${runId}`;
}

const PAYLOAD = {
	ticketId: TICKET_ID,
	runId: RUN_ID,
	correlation: correlationFor(),
};

/** Required payload per event: presence checks only — the runtime cannot verify meaning. */
const REQUIRED_PAYLOADS: Record<string, readonly string[]> = {
	"ticket.selected": ["ticketId", "runId", "correlation"],
	"ticket.planned": ["ticketId", "runId", "correlation", "planRef"],
	"ticket.implemented": ["ticketId", "runId", "correlation", "artifactRef"],
	"ticket.verified": ["ticketId", "runId", "correlation", "evidenceRef"],
	"ticket.pushed": ["ticketId", "runId", "correlation", "commit"],
	"ticket.completed": ["ticketId", "runId", "correlation", "evidenceRef"],
	"stage.blocked": ["ticketId", "runId", "correlation", "reason"],
	"stage.waiting": ["ticketId", "runId", "correlation", "reason"],
	"stage.failed": ["ticketId", "runId", "correlation", "reason"],
};

/** The evidence reference key each success outcome must carry. */
function evidenceRefKey(type: string): string | undefined {
	const refs: Record<string, string> = {
		"ticket.planned": "planRef",
		"ticket.implemented": "artifactRef",
		"ticket.verified": "evidenceRef",
		"ticket.pushed": "commit",
		"ticket.completed": "evidenceRef",
	};
	return refs[type];
}

/** Deterministic operator seed event (mirrors /event-loop emit identity). */
function seedEvent(
	runId = RUN_ID,
	payloadExtra: Record<string, unknown> = {},
	ticketId = TICKET_ID,
): LoopEventData {
	const payload = {
		ticketId,
		runId,
		correlation: correlationFor(runId, ticketId),
		...payloadExtra,
	};
	return {
		eventId: deriveEventId(
			"single-ticket",
			"ticket.selected",
			`ticket.selected:${JSON.stringify(payload)}`,
		),
		type: "ticket.selected",
		occurredAt: "2026-09-05T00:00:00.000Z",
		source: "operator",
		payload,
	};
}

/** An agent outcome event carrying the causation metadata of the stage's command. */
function outcomeEvent(
	type: string,
	command: CommandRecord,
	runId = RUN_ID,
	ticketId = TICKET_ID,
): LoopEventData {
	const refKey = evidenceRefKey(type);
	const payload: Record<string, unknown> = {
		ticketId,
		runId,
		correlation: correlationFor(runId, ticketId),
	};
	if (refKey !== undefined) {
		payload[refKey] = `${type}-evidence`;
	}
	if ((TERMINAL_EVENTS as readonly string[]).includes(type)) {
		payload["reason"] = `${type} reason`;
	}
	return {
		eventId: deriveEventId("single-ticket", type, `${type}:${command.commandId}`),
		type,
		occurredAt: "2026-09-05T00:01:00.000Z",
		source: "agent",
		payload,
		commandId: command.commandId,
		workItemId: command.workItemId,
		correlationId: command.correlationId,
		causationId: command.commandId,
	};
}

interface DrivenRun {
	readonly runtime: ReturnType<typeof createEventLoopRuntime>;
	readonly append: (event: LoopEventData) => void;
	/** The delivered command record for the given stage index (stages complete in order). */
	commandFor(stageIndex: number): CommandRecord;
}

/**
 * Seed the run and advance through the given number of successful stages using the
 * production delivery pipeline (deliver command turn → append outcome → settle).
 */
async function driveToStage(
	completedStages: number,
	runId = RUN_ID,
	ticketId = TICKET_ID,
): Promise<DrivenRun> {
	const runtime = createEventLoopRuntime();
	const apply = createPostAppendPipeline(runtime);
	const append = (event: LoopEventData) => {
		apply(event, CONFIG, CONFIG.activeProfile);
	};
	const deliver = async (): Promise<CommandRecord> => {
		const outcome = await deliverNextCommand(
			{ sendMessage: () => {} },
			runtime,
		);
		const record = runtime.activeCommand;
		if (!outcome.delivered || record === undefined) {
			throw new Error("test drive broken: expected a command delivery");
		}
		return record;
	};
	append(seedEvent(runId, {}, ticketId));
	const commands: CommandRecord[] = [];
	for (const [index, stage] of STAGES.entries()) {
		if (index > completedStages) {
			break;
		}
		const record = await deliver();
		commands.push(record);
		if (index < completedStages) {
			append(outcomeEvent(stage.success, record, runId, ticketId));
			settleActiveCommand(runtime, true);
		}
	}
	return {
		runtime,
		append,
		commandFor: (stageIndex) => commands[stageIndex] as CommandRecord,
	};
}

/** The open (non-completed) row keys of one view. */
function openKeys(
	runtime: ReturnType<typeof createEventLoopRuntime>,
	viewId: string,
): readonly string[] {
	return [...runtime.projection.items.values()]
		.filter((item) => item.viewId === viewId && item.status !== "completed")
		.map((item) => item.key);
}

/** Deliver the head command via the production dispatcher against a runtime. */
async function deliverHead(
	runtime: ReturnType<typeof createEventLoopRuntime>,
): Promise<CommandRecord> {
	const outcome = await deliverNextCommand({ sendMessage: () => {} }, runtime);
	const record = runtime.activeCommand;
	if (!outcome.delivered || record === undefined) {
		throw new Error("test drive broken: expected a command delivery");
	}
	return record;
}

describe("ticket-delivery tracked config (T-895)", () => {
	it("validates through the production parser", () => {
		expect(parsed.ok).toBe(true);
		expect(parsed.errors).toEqual([]);
		expect(CONFIG.activeProfile).toBe("single-ticket");
		expect(PROFILE).toBeDefined();
	});

	it("encodes the plan-suggested limits with timers required to be empty", () => {
		expect(CONFIG.limits).toMatchObject({
			maxPendingCommands: 1,
			maxChainDepth: 12,
			maxConsecutiveTurns: 8,
		});
		expect(PROFILE.timers).toEqual([]);
	});

	it("has an operator-only seed and no allowWithoutCommand agent starts", () => {
		const events = Object.entries(PROFILE.events);
		const nonAgent = events.filter(([, spec]) => !spec.allowAgentEmit);
		expect(nonAgent.map(([name]) => name)).toEqual(["ticket.selected"]);
		for (const [name, spec] of events) {
			expect(spec.allowWithoutCommand, name).toBeUndefined();
			expect(spec.requiredPayload, name).toEqual(REQUIRED_PAYLOADS[name]);
		}
	});

	it("binds every agent-emittable event to a command contract", () => {
		const expected = new Set(
			Object.values(PROFILE.commands).flatMap((command) => command.expectedEvents),
		);
		for (const [name, spec] of Object.entries(PROFILE.events)) {
			if (spec.allowAgentEmit) {
				expect(expected.has(name), name).toBe(true);
			}
		}
	});

	it("chains the five stages on /correlation and opens no successor on completion", () => {
		expect(Object.keys(PROFILE.views)).toEqual(STAGES.map((stage) => stage.view));
		for (const [index, stage] of STAGES.entries()) {
			const view = PROFILE.views[stage.view];
			const previous =
				index === 0 ? "ticket.selected" : STAGES[index - 1]?.success;
			expect(view?.openOn.map((rule) => rule.event)).toEqual([previous]);
			expect(view?.openOn.map((rule) => rule.keyFrom)).toEqual(["/correlation"]);
			const closeEvents = view?.closeOn.map((rule) => rule.event) ?? [];
			expect(
				view?.closeOn.every((rule) => rule.keyFrom === "/correlation"),
				stage.view,
			).toBe(true);
			expect(closeEvents, stage.view).toContain(stage.success);
			for (const terminal of TERMINAL_EVENTS) {
				expect(closeEvents, stage.view).toContain(terminal);
			}
		}
		for (const [viewName, view] of Object.entries(PROFILE.views)) {
			const openEvents = view.openOn.map((rule) => rule.event);
			expect(openEvents, viewName).not.toContain("ticket.completed");
			for (const terminal of TERMINAL_EVENTS) {
				expect(openEvents, viewName).not.toContain(terminal);
			}
		}
	});

	it("binds one automation per stage view to its stage command", () => {
		expect(PROFILE.automations.map((automation) => automation.view)).toEqual(
			STAGES.map((stage) => stage.view),
		);
		expect(PROFILE.automations.map((automation) => automation.issue)).toEqual(
			STAGES.map((stage) => stage.command),
		);
	});

	it("prompts revalidation of the three correlation fields without claiming semantic enforcement", () => {
		for (const [name, command] of Object.entries(PROFILE.commands)) {
			expect(command.message, name).toContain("correlation");
			expect(command.message, name).toContain("ticketId");
			expect(command.message, name).toContain("runId");
			expect(command.message, name).toContain("presence and key match only");
		}
	});

	it("delivers self-describing command messages", async () => {
		const driven = await driveToStage(0);
		const message = buildCommandMessage(driven.commandFor(0));
		expect(message.customType).toBe(COMMAND_MESSAGE_CUSTOM_TYPE);
		expect(message.details.correlationId).toBe(correlationFor());
		expect(message.details.expectedEvents).toContain("ticket.planned");
		expect(message.content).toContain("untrusted");
	});
});

describe("ticket-delivery success chain", () => {
	it("opens no rows or commands without a well-formed seed", () => {
		const runtime = createEventLoopRuntime();
		const apply = createPostAppendPipeline(runtime);
		const unkeyed = seedEvent();
		apply(
			{ ...unkeyed, payload: { ticketId: TICKET_ID, runId: RUN_ID } },
			CONFIG,
			CONFIG.activeProfile,
		);
		// Without correlation the projection key cannot resolve, so no row opens.
		expect(runtime.projection.items.size).toBe(0);
		expect(runtime.queue).toEqual([]);
	});

	it("delivers exactly one plan command per seed with compound correlation", async () => {
		const driven = await driveToStage(0);
		const record = driven.commandFor(0);
		expect(record.type).toBe("plan-ticket");
		expect(record.correlationId).toBe(correlationFor());
		expect(record.workItem).toMatchObject(PAYLOAD);
		expect(openKeys(driven.runtime, "stage-plan")).toEqual([correlationFor()]);
	});

	it("walks all five stages, then terminates with no open rows or commands", async () => {
		const driven = await driveToStage(4);
		const finalCommand = driven.commandFor(4);
		const completion = outcomeEvent("ticket.completed", finalCommand);
		driven.append(completion);
		settleActiveCommand(driven.runtime, true);
		for (const stage of STAGES) {
			expect(openKeys(driven.runtime, stage.view), stage.view).toEqual([]);
		}
		expect(driven.runtime.queue).toEqual([]);
		expect(driven.runtime.activeCommand).toBeUndefined();
		expect(driven.runtime.paused).toBe(false);
		expect(
			eventChainDepth(completion.eventId, driven.runtime.projection),
		).toBeLessThanOrEqual(CONFIG.limits.maxChainDepth);
	});

	it("keeps one pending command and bounded turns at every stage hop", async () => {
		const runtime = createEventLoopRuntime();
		const apply = createPostAppendPipeline(runtime);
		const append = (event: LoopEventData) => {
			apply(event, CONFIG, CONFIG.activeProfile);
		};
		append(seedEvent());
		for (const [index, stage] of STAGES.entries()) {
			const record = await deliverHead(runtime);
			expect(record.type, stage.command).toBe(stage.command);
			expect(runtime.consecutiveAutomatedTurns).toBeLessThanOrEqual(
				CONFIG.limits.maxConsecutiveTurns,
			);
			expect(runtime.paused).toBe(false);
			append(outcomeEvent(stage.success, record));
			settleActiveCommand(runtime, true);
			// Exactly one successor waits for delivery after each settled hop; none after the last.
			expect(runtime.queue).toHaveLength(index < STAGES.length - 1 ? 1 : 0);
		}
		for (const stage of STAGES) {
			expect(openKeys(runtime, stage.view)).toEqual([]);
		}
	});

	it("holds the single-open-stage invariant across the whole chain", async () => {
		const runtime = createEventLoopRuntime();
		const apply = createPostAppendPipeline(runtime);
		const append = (event: LoopEventData) => {
			apply(event, CONFIG, CONFIG.activeProfile);
		};
		append(seedEvent());
		for (const [index, stage] of STAGES.entries()) {
			// Exactly the current stage's view carries exactly one open row.
			for (const [viewIndex, stageView] of STAGES.entries()) {
				const expected = viewIndex === index ? [correlationFor()] : [];
				expect(openKeys(runtime, stageView.view), stageView.view).toEqual(expected);
			}
			const record = await deliverHead(runtime);
			append(outcomeEvent(stage.success, record));
			settleActiveCommand(runtime, true);
		}
		for (const stage of STAGES) {
			expect(openKeys(runtime, stage.view), stage.view).toEqual([]);
		}
	});

	it("full success chain with mock delegation stays within chain-depth limits", async () => {
		const runtime = createEventLoopRuntime();
		const apply = createPostAppendPipeline(runtime);
		const append = (event: LoopEventData) => {
			apply(event, CONFIG, CONFIG.activeProfile);
		};
		append(seedEvent());
		const planCommand = await deliverHead(runtime);
		append(outcomeEvent("ticket.planned", planCommand));
		settleActiveCommand(runtime, true);

		// Mock delegation: the implement stage hands work to a worker. Worker calls are DOMAIN
		// actions performed by the agent outside the event loop — they append no loop event and
		// carry no causation, so worker completion is invisible here (the profile intentionally
		// has no worker-completion subscription). Only the agent's outcome event advances the loop.
		const eventsBeforeWorker = runtime.projectedEventCount;
		const queueBeforeWorker = runtime.queue;
		const mockWorkerCall = async (): Promise<string> => "worker-artifact-ref";
		const artifactRef = await mockWorkerCall();
		// The worker call adds no events and no commands; the implement command stays queued.
		expect(runtime.projectedEventCount).toBe(eventsBeforeWorker);
		expect(runtime.queue).toEqual(queueBeforeWorker);
		expect(runtime.queue.map((record) => record.type)).toEqual(["implement-ticket"]);
		expect(artifactRef).toBe("worker-artifact-ref");

		const implementCommand = await deliverHead(runtime);
		append(outcomeEvent("ticket.implemented", implementCommand));
		settleActiveCommand(runtime, true);
		for (const index of [2, 3, 4]) {
			const stage = STAGES[index];
			const record = await deliverHead(runtime);
			append(outcomeEvent(stage?.success ?? "", record));
			settleActiveCommand(runtime, true);
		}
		for (const stage of STAGES) {
			expect(openKeys(runtime, stage.view), stage.view).toEqual([]);
		}
		expect(runtime.paused).toBe(false);
		// Depth counts automated command hops between outcome events only (seed → 5 outcomes = 5),
		// so delegation cannot inflate it; 5 stays within maxChainDepth 12.
		const lastStage = STAGES[STAGES.length - 1];
		expect(eventChainDepth(runtime.lastAppliedEventId ?? "", runtime.projection)).toBe(
			lastStage ? STAGES.indexOf(lastStage) + 1 : 0,
		);
		expect(
			eventChainDepth(runtime.lastAppliedEventId ?? "", runtime.projection),
		).toBeLessThanOrEqual(CONFIG.limits.maxChainDepth);
	});
});

describe("ticket-delivery terminal paths", () => {
	for (const [stageIndex, stage] of STAGES.entries()) {
		for (const terminal of TERMINAL_EVENTS) {
			it(`${terminal} at stage ${stageIndex + 1} (${stage.command}) closes the row and opens no successor`, async () => {
				const driven = await driveToStage(stageIndex);
				const command = driven.commandFor(stageIndex);
				driven.append(outcomeEvent(terminal, command));
				settleActiveCommand(driven.runtime, true);
				expect(openKeys(driven.runtime, stage.view)).toEqual([]);
				for (const later of STAGES.slice(stageIndex + 1)) {
					expect(openKeys(driven.runtime, later.view), later.view).toEqual([]);
				}
				expect(driven.runtime.queue).toEqual([]);
				// Domain halt without the runtime pause bit (plan: distinguish from missing-outcome pauses).
				expect(driven.runtime.paused).toBe(false);
			});
		}
	}
});

describe("ticket-delivery seed idempotence and compound correlation", () => {
	it("ignores a semantically identical duplicate seed", async () => {
		const driven = await driveToStage(0);
		const runtime = driven.runtime;
		driven.append(seedEvent());
		expect(openKeys(runtime, "stage-plan")).toEqual([correlationFor()]);
		expect(runtime.queue).toHaveLength(0);
	});

	it("treats a semantically different re-seed as a new row (documented operator hazard)", async () => {
		const driven = await driveToStage(1);
		driven.append(seedEvent(RUN_ID, { note: "re-seed" }));
		expect(openKeys(driven.runtime, "stage-plan")).toEqual([correlationFor()]);
		expect(driven.runtime.queue.map((record) => record.type)).toEqual(["plan-ticket"]);
	});

	it("keeps distinct run ids isolated at the projection level", async () => {
		const driven = await driveToStage(1, "t886-run-a");
		driven.append(seedEvent("t886-run-b"));
		driven.append(
			outcomeEvent("stage.blocked", driven.commandFor(1), "t886-run-a"),
		);
		expect(openKeys(driven.runtime, "stage-implement")).toEqual([]);
		expect(openKeys(driven.runtime, "stage-plan")).toEqual([
			correlationFor("t886-run-b"),
		]);
		expect(driven.runtime.queue.map((record) => record.correlationId)).toEqual([
			correlationFor("t886-run-b"),
		]);
	});

	it("cannot cross-close two tickets sharing a runId when correlation differs", async () => {
		const driven = await driveToStage(1, "t886-shared-run");
		driven.append(seedEvent("t886-shared-run", {}, "T-999"));
		// T-886's run is blocked; only its own rows close.
		driven.append(
			outcomeEvent("stage.blocked", driven.commandFor(1), "t886-shared-run"),
		);
		expect(openKeys(driven.runtime, "stage-implement")).toEqual([]);
		expect(openKeys(driven.runtime, "stage-plan")).toEqual([
			correlationFor("t886-shared-run", "T-999"),
		]);
		expect(driven.runtime.queue.map((record) => record.correlationId)).toEqual([
			correlationFor("t886-shared-run", "T-999"),
		]);
	});

	it("rejects agent emission of the operator-only seed", () => {
		const decision = evaluateEmission(
			{
				config: CONFIG,
				profileName: CONFIG.activeProfile,
				source: "agent",
				activeCommand: undefined,
				activeWorkItem: undefined,
				knownEventIds: new Set<string>(),
				now: () => "2026-09-05T00:00:00.000Z",
			},
			{ event: "ticket.selected", dedupeKey: "x", payload: PAYLOAD },
		);
		expect(decision.ok).toBe(false);
	});

	it("rejects an outcome whose correlation points at a different run of the same ticket", async () => {
		const driven = await driveToStage(1, "t886-run-a");
		const command = driven.commandFor(1);
		const decision = evaluateEmission(
			{
				config: CONFIG,
				profileName: CONFIG.activeProfile,
				source: "agent",
				activeCommand: command,
				activeWorkItem: {
					workItemId: command.workItemId,
					viewId: command.viewId,
					key: command.correlationId,
					openedByEventId: command.causedBy,
					sourcePayload: command.workItem,
					status: "dispatched",
					commandId: command.commandId,
				},
				knownEventIds: new Set<string>(),
				now: () => "2026-09-05T00:02:00.000Z",
			},
			{
				event: "stage.blocked",
				dedupeKey: "cross-run",
				payload: {
					ticketId: TICKET_ID,
					runId: "t886-run-b",
					correlation: correlationFor("t886-run-b"),
					reason: "blocked cross-run probe",
				},
			},
		);
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain(
				`points to work item key ${correlationFor("t886-run-b")}`,
			);
			expect(decision.reason).toContain(correlationFor("t886-run-a"));
		}
	});

	it("does not validate correlation's internal format (presence and key match only)", async () => {
		// The runtime cannot verify that correlation equals '<ticketId>:<runId>': an opaque
		// correlation opens a row and matches outcomes exactly like a composed one.
		const opaque = "opaque-correlation-key";
		const runtime = createEventLoopRuntime();
		const apply = createPostAppendPipeline(runtime);
		apply(
			seedEvent(RUN_ID, { correlation: opaque }),
			CONFIG,
			CONFIG.activeProfile,
		);
		expect(openKeys(runtime, "stage-plan")).toEqual([opaque]);
		const command = await deliverHead(runtime);
		const decision = evaluateEmission(
			{
				config: CONFIG,
				profileName: CONFIG.activeProfile,
				source: "agent",
				activeCommand: command,
				activeWorkItem: {
					workItemId: command.workItemId,
					viewId: command.viewId,
					key: command.correlationId,
					openedByEventId: command.causedBy,
					sourcePayload: command.workItem,
					status: "dispatched",
					commandId: command.commandId,
				},
				knownEventIds: new Set<string>(),
				now: () => "2026-09-05T00:02:00.000Z",
			},
			{
				event: "ticket.planned",
				dedupeKey: "opaque-planned",
				payload: {
					ticketId: TICKET_ID,
					runId: RUN_ID,
					correlation: opaque,
					planRef: "ticket-note-anchor",
				},
			},
		);
		expect(decision.ok).toBe(true);
	});

	it("requires reason on terminal outcomes and evidence refs on success outcomes", () => {
		const emit = (event: string, payload: Record<string, unknown>) =>
			evaluateEmission(
				{
					config: CONFIG,
					profileName: CONFIG.activeProfile,
					source: "operator",
					activeCommand: undefined,
					activeWorkItem: undefined,
					knownEventIds: new Set<string>(),
					now: () => "2026-09-05T00:00:00.000Z",
				},
				{ event, dedupeKey: `${event}:${JSON.stringify(payload)}`, payload },
			);
		const noReason = emit("stage.blocked", PAYLOAD);
		expect(noReason.ok).toBe(false);
		if (!noReason.ok) {
			expect(noReason.reason).toContain('missing required payload key "reason"');
		}
		const noRef = emit("ticket.verified", PAYLOAD);
		expect(noRef.ok).toBe(false);
		if (!noRef.ok) {
			expect(noRef.reason).toContain('missing required payload key "evidenceRef"');
		}
	});

	it("requires ticketId, runId and correlation in every event payload", () => {
		const emit = (payload: Record<string, unknown>) =>
			evaluateEmission(
				{
					config: CONFIG,
					profileName: CONFIG.activeProfile,
					source: "operator",
					activeCommand: undefined,
					activeWorkItem: undefined,
					knownEventIds: new Set<string>(),
					now: () => "2026-09-05T00:00:00.000Z",
				},
				{
					event: "ticket.selected",
					dedupeKey: `missing:${JSON.stringify(payload)}`,
					payload,
				},
			);
		const noRunId = emit({ ticketId: TICKET_ID, correlation: correlationFor() });
		expect(noRunId.ok).toBe(false);
		if (!noRunId.ok) {
			expect(noRunId.reason).toContain('missing required payload key "runId"');
		}
		const noCorrelation = emit({ ticketId: TICKET_ID, runId: RUN_ID });
		expect(noCorrelation.ok).toBe(false);
		if (!noCorrelation.ok) {
			expect(noCorrelation.reason).toContain(
				'missing required payload key "correlation"',
			);
		}
	});
});
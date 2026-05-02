/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { findAgentByName } from "../../lib/agent-api.js";
import { askAgent } from "./agent-runner.js";
import { deliberate, formatFailures, preflight } from "./deliberation.js";
import { snapshotAvailableModels } from "./members.js";
import { type PairResult, runPairCoding } from "./pair-coding.js";
import { navigatorConsultSystemPrompt } from "./pair-prompts.js";
import { currentPanopticonRecord, runMember } from "./runner.js";
import { resolveCouncilSettings } from "./settings.js";
import type { CouncilStateManager } from "./state.js";
import { teamToCouncilDefinition } from "./team-registry.js";
import type { TeamModels, TeamSpec } from "./team-types.js";
import type { CouncilDefinition } from "./types.js";

export const TEAM_STATUS_KEY = "team";
const CONSULT_TIMEOUT_MS = 5 * 60_000;

export interface TeamRunModels {
	members?: string[];
	chairman?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamRunLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
}

export interface TeamRunInput {
	id: string;
	prompt: string;
	files?: string[];
	specPath?: string;
	models?: TeamRunModels;
	limits?: TeamRunLimits;
}

export interface TeamModelSlot {
	id: string;
	label: string;
	current?: string;
	kind: "member" | "chairman" | "driver" | "navigator";
	index?: number;
}

interface TeamHandlerResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

interface ConsultOutcome {
	body: string;
	ok: boolean;
	durationMs: number;
}

interface TeamHandlerRunArgs {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: CouncilStateManager;
}

interface TeamHandler {
	key: string;
	matches(team: TeamSpec): boolean;
	modelSlots(team: TeamSpec, models: TeamModels): TeamModelSlot[];
	run(args: TeamHandlerRunArgs): Promise<TeamHandlerResult>;
}

function okText(text: string, details: Record<string, unknown>): TeamHandlerResult {
	return { content: [{ type: "text", text }], details };
}

function rejectAgentRef(role: "driver" | "navigator", value: string): string | undefined {
	if (value.toLowerCase().startsWith("agent:")) {
		return `pair-coding ${role} must be a model id, not an agent ref ("${value}").`;
	}
	return undefined;
}

function memberModelSlots(args: {
	count: number;
	label: (index: number) => string;
	models: TeamModels;
}): TeamModelSlot[] {
	return Array.from({ length: args.count }, (_value, index) => ({
		id: `member:${index}`,
		label: args.label(index),
		current: args.models.members?.[index],
		kind: "member" as const,
		index,
	}));
}

function formatPairResult(result: PairResult): TeamHandlerResult {
	const sections: string[] = [];
	if (result.context.warnings.length > 0) {
		sections.push(
			`Context warnings:\n${result.context.warnings.map((warning) => `- ${warning}`).join("\n")}`,
		);
	}
	if (result.errors.length > 0) {
		sections.push(`Errors:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
	}
	const body = sections.length > 0
		? `${result.summary}\n\n${sections.join("\n\n")}`
		: result.summary;
	return okText(body, {
		team: "pair-coding",
		mode: result.mode,
		ok: result.ok,
		phases: result.phases,
		context: result.context,
		warnings: result.context.warnings,
	});
}

async function consultModel(args: {
	navigator: string;
	message: string;
	ctx: ExtensionContext;
}): Promise<ConsultOutcome> {
	const promptsConfig = resolveCouncilSettings().prompts;
	const run = await runMember(
		{ label: "Navigator", model: args.navigator },
		{
			prompt: args.message,
			systemPrompt: navigatorConsultSystemPrompt(promptsConfig),
			cwd: args.ctx.cwd,
			signal: args.ctx.signal,
			parentId: (await currentPanopticonRecord(args.ctx.cwd))?.id,
		},
	);
	return {
		body: run.ok ? run.output : `Navigator failed: ${run.error ?? "unknown error"}`,
		ok: run.ok,
		durationMs: run.durationMs,
	};
}

async function consultAgent(args: {
	navigator: string;
	message: string;
	ctx: ExtensionContext;
	teamId: string;
}): Promise<ConsultOutcome> {
	const startedAt = Date.now();
	const promptsConfig = resolveCouncilSettings().prompts;
	const agentName = args.navigator.slice("agent:".length);
	const info = findAgentByName(agentName);
	if (!info) {
		return { body: `Agent "${agentName}" is no longer registered.`, ok: false, durationMs: Date.now() - startedAt };
	}
	if (!info.alive) {
		return {
			body: `Agent "${agentName}" is not alive (status=${info.status}).`,
			ok: false,
			durationMs: Date.now() - startedAt,
		};
	}
	const ourRecord = await currentPanopticonRecord(args.ctx.cwd);
	if (!ourRecord) {
		return {
			body: "Pilot is not registered with panopticon — cannot reach live agents.",
			ok: false,
			durationMs: Date.now() - startedAt,
		};
	}
	const consultId = `team-${args.teamId}-${Date.now().toString(36)}`;
	const reply = await askAgent({
		agentName: info.name,
		agentId: info.id,
		memberLabel: "Navigator",
		prompt: args.message,
		systemPrompt: navigatorConsultSystemPrompt(promptsConfig),
		deliberationId: consultId,
		stage: "consult",
		ourAgentId: ourRecord.id,
		ourAgentName: ourRecord.name,
		signal: args.ctx.signal,
		timeoutMs: CONSULT_TIMEOUT_MS,
	});
	return {
		body: reply.ok ? reply.output : `Navigator failed: ${reply.error ?? "unknown error"}`,
		ok: reply.ok,
		durationMs: reply.durationMs,
	};
}

function telephoneSystemPrompt(index: number, total: number): string {
	return [
		`You are relay ${index} of ${total} in a telephone-game chain.`,
		"You receive the current message from the previous relay and pass one message to the next relay.",
		"Preserve the core meaning, but rewrite naturally in your own words.",
		"Do not add explanations, markdown, labels, or commentary.",
		"Return only the message to pass along.",
	].join("\n");
}

const debateHandler: TeamHandler = {
	key: "debate",
	matches(team) {
		return team.topology === "council" && team.protocol === "debate";
	},
	modelSlots(_team, models) {
		const memberCount = Math.max(models.members?.length ?? 0, 1);
		return [
			...memberModelSlots({
				count: memberCount,
				label: (index) => `Member model ${index + 1}`,
				models,
			}),
			{
				id: "chairman",
				label: "Chairman model",
				current: models.chairman,
				kind: "chairman",
			},
		];
	},
	async run(args) {
		const snapshot = snapshotAvailableModels(args.ctx);
		const base = teamToCouncilDefinition({ team: args.team, snapshot });
		const definition: CouncilDefinition = {
			...base,
			members: args.params.models?.members ?? base.members,
			chairman: args.params.models?.chairman ?? base.chairman,
		};
		const report = preflight(definition, snapshot);
		args.ctx.ui.notify(`Team "${args.team.id}" debating with ${definition.members.length} member(s)...`, "info");
		const record = await deliberate({
			definition,
			prompt: args.params.prompt,
			ctx: args.ctx,
			availableSnapshot: snapshot,
			stateManager: args.stateManager,
			parallelTimeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			onProgress: (text) => {
				args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${text}`);
			},
		});
		const failures = [...record.generation, ...record.critiques].filter((run) => !run.ok);
		const sections: string[] = [];
		if (report.warnings.length > 0) {
			sections.push(`Pre-flight warnings:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}`);
		}
		if (failures.length > 0) sections.push(`Partial failures:\n${formatFailures(failures)}`);
		const synthesis = record.synthesis?.output ?? "(no synthesis)";
		const body = sections.length > 0 ? `${synthesis}\n\n${sections.join("\n\n")}` : synthesis;
		return okText(body, {
			team: args.team.id,
			id: record.id,
			members: record.members.map((member) => member.model),
			chairman: record.chairman.model,
			warnings: report.warnings,
		});
	},
};

const pairCodingHandler: TeamHandler = {
	key: "pair-coding",
	matches(team) {
		return team.topology === "pair" && team.protocol === "pair-coding";
	},
	modelSlots(_team, models) {
		return [
			{
				id: "driver",
				label: "Driver model",
				current: models.driver,
				kind: "driver",
			},
			{
				id: "navigator",
				label: "Navigator model",
				current: models.navigator,
				kind: "navigator",
			},
		];
	},
	async run(args) {
		const settings = resolveCouncilSettings();
		const driver = args.params.models?.driver ?? args.team.models.driver ?? settings.defaultMembers[0];
		const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? settings.defaultChairman;
		if (!driver || !navigator) throw new Error("pair-coding needs driver and navigator models.");
		const driverError = rejectAgentRef("driver", driver);
		if (driverError) throw new Error(driverError);
		const navigatorError = rejectAgentRef("navigator", navigator);
		if (navigatorError) throw new Error(navigatorError);
		args.ctx.ui.notify(`Team "${args.team.id}": driver=${driver} navigator=${navigator}`, "info");
		const result = await runPairCoding({
			ctx: args.ctx,
			prompt: args.params.prompt,
			driver,
			navigator,
			files: args.params.files,
			specPath: args.params.specPath,
			maxFixPasses: args.params.limits?.maxFixPasses ?? args.team.limits.maxFixPasses,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			onProgress: (label) => {
				args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${label}`);
			},
		});
		return formatPairResult(result);
	},
};

const pairConsultHandler: TeamHandler = {
	key: "consult",
	matches(team) {
		return team.topology === "pair" && team.protocol === "consult";
	},
	modelSlots(_team, models) {
		return [
			{
				id: "navigator",
				label: "Navigator model",
				current: models.navigator,
				kind: "navigator",
			},
		];
	},
	async run(args) {
		const settings = resolveCouncilSettings();
		const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? settings.defaultPair?.navigator;
		if (!navigator) throw new Error("pair-consult needs a navigator model or agent ref.");
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: consulting ${navigator}`);
		const outcome = navigator.startsWith("agent:")
			? await consultAgent({ navigator, message: args.params.prompt, ctx: args.ctx, teamId: args.team.id })
			: await consultModel({ navigator, message: args.params.prompt, ctx: args.ctx });
		return okText(outcome.body, {
			team: args.team.id,
			navigator,
			durationMs: outcome.durationMs,
			ok: outcome.ok,
		});
	},
};

const telephoneHandler: TeamHandler = {
	key: "telephone",
	matches(team) {
		return team.topology === "chain" && team.protocol === "telephone";
	},
	modelSlots(team, models) {
		const memberCount = Math.max(models.members?.length ?? 0, team.agents.length, 1);
		return memberModelSlots({
			count: memberCount,
			label: (index) => `Relay model ${index + 1}`,
			models,
		});
	},
	async run(args) {
		const settings = resolveCouncilSettings();
		const models = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
		const fallbackModel = models[0];
		if (!fallbackModel) throw new Error("telephone teams need at least one member model.");
		let message = args.params.prompt;
		const hops: Array<{ agent: string; model: string; ok: boolean; output: string; durationMs: number }> = [];
		for (const [index, agent] of args.team.agents.entries()) {
			const model = models[index] ?? fallbackModel;
			args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: relay ${index + 1}/${args.team.agents.length}`);
			const run = await runMember(
				{ label: agent, model },
				{
					prompt: `Current message:\n\n${message}`,
					systemPrompt: telephoneSystemPrompt(index + 1, args.team.agents.length),
					cwd: args.ctx.cwd,
					signal: args.ctx.signal,
					parentId: (await currentPanopticonRecord(args.ctx.cwd))?.id,
				},
			);
			const output = run.ok ? run.output.trim() : message;
			hops.push({ agent, model, ok: run.ok, output, durationMs: run.durationMs });
			message = output;
		}
		return okText(message, {
			team: args.team.id,
			ok: hops.every((hop) => hop.ok),
			hops,
		});
	},
};

const TEAM_HANDLERS: readonly TeamHandler[] = [
	debateHandler,
	pairCodingHandler,
	pairConsultHandler,
	telephoneHandler,
];

export function getTeamHandler(team: TeamSpec): TeamHandler | undefined {
	return TEAM_HANDLERS.find((handler) => handler.matches(team));
}

export function modelSlotsForTeam(team: TeamSpec, models: TeamModels): TeamModelSlot[] {
	const handler = getTeamHandler(team);
	if (!handler) return [];
	return handler.modelSlots(team, models);
}

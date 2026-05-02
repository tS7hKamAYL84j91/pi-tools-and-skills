/**
 * Team execution tool for the council extension.
 *
 * This is the standard execution surface after the teams migration. It runs
 * validated team specs through the existing low-level debate and pair engines.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { findAgentByName } from "../../lib/agent-api.js";
import { askAgent } from "./agent-runner.js";
import { deliberate, formatFailures, preflight } from "./deliberation.js";
import { snapshotAvailableModels } from "./members.js";
import { type PairResult, runPairCoding } from "./pair-coding.js";
import { navigatorConsultSystemPrompt } from "./pair-prompts.js";
import { currentPanopticonRecord, runMember } from "./runner.js";
import { resolveCouncilSettings } from "./settings.js";
import type { CouncilStateManager } from "./state.js";
import { loadTeamRegistry, teamToCouncilDefinition, type TeamSpec } from "./teams.js";
import type { CouncilDefinition } from "./types.js";

const TEAM_STATUS_KEY = "team";
const CONSULT_TIMEOUT_MS = 5 * 60_000;

interface TeamRunModels {
	members?: string[];
	chairman?: string;
	driver?: string;
	navigator?: string;
}

interface TeamRunLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
}

interface TeamRunInput {
	id: string;
	prompt: string;
	files?: string[];
	specPath?: string;
	models?: TeamRunModels;
	limits?: TeamRunLimits;
}

interface TeamRunRegistration {
	stateManager: CouncilStateManager;
}

interface ConsultOutcome {
	body: string;
	ok: boolean;
	durationMs: number;
}

const TeamRunSchema = Type.Object({
	id: Type.String({ description: "Team id to run, e.g. default-council, pair-consult, pair-coding." }),
	prompt: Type.String({ description: "Task, question, or review request for the team." }),
	files: Type.Optional(Type.Array(Type.String(), { description: "pair-coding: files to load." })),
	specPath: Type.Optional(Type.String({ description: "pair-coding: spec path; defaults to spec.md or docs/spec.md." })),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "council: override member model IDs." })),
		chairman: Type.Optional(Type.String({ description: "council: override synthesis model ID." })),
		driver: Type.Optional(Type.String({ description: "pair-coding: override Driver model." })),
		navigator: Type.Optional(Type.String({ description: "pair workflows: override Navigator model or agent ref." })),
	})),
	limits: Type.Optional(Type.Object({
		maxFixPasses: Type.Optional(Type.Number({ description: "pair-coding: fix passes." })),
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
	})),
});

function okText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function requireTeam(id: string): TeamSpec {
	const registry = loadTeamRegistry();
	const team = registry.teams.get(id);
	if (!team) {
		throw new Error(
			`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
		);
	}
	const teamWarnings = registry.warnings.filter((warning) => warning.startsWith(`${id}:`));
	if (teamWarnings.length > 0) {
		throw new Error(`Team "${id}" is invalid:\n${teamWarnings.join("\n")}`);
	}
	return team;
}

function rejectAgentRef(role: "driver" | "navigator", value: string): string | undefined {
	if (value.toLowerCase().startsWith("agent:")) {
		return `pair-coding ${role} must be a model id, not an agent ref ("${value}").`;
	}
	return undefined;
}

function formatPairResult(result: PairResult): ReturnType<typeof okText> {
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

async function runDebateTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: CouncilStateManager;
}) {
	if (args.team.topology !== "council" || args.team.protocol !== "debate") {
		throw new Error(`Team "${args.team.id}" is not a debate team.`);
	}
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
}

async function runPairCodingTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
}) {
	if (args.team.topology !== "pair" || args.team.protocol !== "pair-coding") {
		throw new Error(`Team "${args.team.id}" is not a pair-coding team.`);
	}
	const settings = resolveCouncilSettings();
	const driver = args.params.models?.driver ?? settings.defaultMembers[0];
	const navigator = args.params.models?.navigator ?? settings.defaultChairman;
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
	if (!info) return { body: `Agent "${agentName}" is no longer registered.`, ok: false, durationMs: Date.now() - startedAt };
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

async function runPairConsultTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
}) {
	if (args.team.topology !== "pair" || args.team.protocol !== "consult") {
		throw new Error(`Team "${args.team.id}" is not a pair-consult team.`);
	}
	const settings = resolveCouncilSettings();
	const navigator = args.params.models?.navigator ?? settings.defaultPair?.navigator;
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
}

async function runTeam(args: {
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: CouncilStateManager;
}) {
	const team = requireTeam(args.params.id);
	if (team.topology === "council" && team.protocol === "debate") {
		return runDebateTeam({ team, params: args.params, ctx: args.ctx, stateManager: args.stateManager });
	}
	if (team.topology === "pair" && team.protocol === "pair-coding") {
		return runPairCodingTeam({ team, params: args.params, ctx: args.ctx });
	}
	if (team.topology === "pair" && team.protocol === "consult") {
		return runPairConsultTeam({ team, params: args.params, ctx: args.ctx });
	}
	throw new Error(`Team "${team.id}" has unsupported topology/protocol ${team.topology}/${team.protocol}.`);
}

export function registerTeamRunTool(
	pi: ExtensionAPI,
	registration: TeamRunRegistration,
): void {
	pi.registerTool({
		name: "team_run",
		label: "Run Team",
		description: "Run a declarative built-in team by id. Use team_list first if you do not know the team id.",
		promptSnippet: "Run a declarative council or pair team by id",
		promptGuidelines: [
			"Use team_run with id=default-council for high-impact architecture, strategy, or research where disagreement is valuable.",
			"Use team_run with id=pair-consult for lightweight Navigator review.",
			"Use team_run with id=pair-coding only when an automated Driver/Navigator implementation loop is explicitly requested.",
		],
		parameters: TeamRunSchema,
		async execute(_id, params: TeamRunInput, _signal, _onUpdate, ctx) {
			try {
				return await runTeam({ params, ctx, stateManager: registration.stateManager });
			} finally {
				ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready");
			}
		},
	});
}

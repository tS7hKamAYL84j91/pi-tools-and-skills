/** Session-only `/team` interaction mode for synthesis-first team assistance. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildTeamContext } from "./team-context.js";
import { resolveTeamProfile, type TeamProfile } from "./team-profiles.js";
import { runTeam, type TeamRunRegistration } from "./team-runtime.js";
import { isTopology, type TeamRoute } from "./team-routes.js";

type TeamModeState = "off" | "on" | "auto" | "once";

interface SessionTeamMode {
	state: TeamModeState;
	topology: TeamRoute;
	maxModels: number;
	maxModelsExplicit?: boolean;
	profile?: TeamProfile;
	approved: boolean;
	prompt?: string;
}

interface ParseResult {
	action: "on" | "off" | "auto" | "once" | "status";
	topology?: TeamRoute;
	maxModels?: number;
	profile?: TeamProfile;
	prompt?: string;
}

interface TeamRunOutcomeDetails {
	degraded?: boolean;
	failureReason?: string;
	stopped?: boolean;
	nodes?: ReadonlyArray<{ ok?: boolean; model?: string; error?: string }>;
}

const DEFAULT_TOPOLOGY: TeamRoute = "fusion-analysis";
const DEFAULT_MAX_MODELS = 2;
const OVERRIDE_MAX_MODELS = 3;
const HARD_MAX_MODELS = 5;
const LARGE_CONTEXT_CHARS = 12_000;

function defaultState(): SessionTeamMode {
	return { state: "off", topology: DEFAULT_TOPOLOGY, maxModels: DEFAULT_MAX_MODELS, maxModelsExplicit: false, profile: "balanced", approved: false };
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseTeamModeArgs(rawArgs: string): ParseResult {
	const trimmed = rawArgs.trim();
	const firstFlagIndex = trimmed.search(/\s+--/);
	const head = firstFlagIndex === -1 ? trimmed : trimmed.slice(0, firstFlagIndex);
	const flagPart = firstFlagIndex === -1 ? "" : trimmed.slice(firstFlagIndex).trim();
	const headTokens = head.split(/\s+/).filter(Boolean);
	const command = headTokens.shift() ?? "status";
	if (command !== "on" && command !== "off" && command !== "auto" && command !== "once" && command !== "status") {
		throw new Error("Usage: /team on|auto|off|status|once [prompt] [--topology fusion-analysis|llm-council|navigator] [--profile fast|balanced|thorough] [--max-models 1-5]");
	}
	const inlinePrompt = headTokens.join(" ").trim() || undefined;
	const result: ParseResult = { action: command, prompt: inlinePrompt };
	const tokens = flagPart.split(/\s+/).filter(Boolean);
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--topology") {
			const topology = tokens[++index];
			if (!topology || !isTopology(topology)) throw new Error("--topology must be fusion-analysis, llm-council, or navigator");
			result.topology = topology;
			continue;
		}
		if (token === "--max-models") {
			const maxModels = parsePositiveInt(tokens[++index]);
			if (maxModels === undefined || maxModels > HARD_MAX_MODELS) throw new Error("--max-models must be an integer from 1 to 5");
			result.maxModels = maxModels;
			continue;
		}
		if (token === "--profile") {
			const profile = tokens[++index];
			if (profile !== "fast" && profile !== "balanced" && profile !== "thorough") throw new Error("--profile must be fast, balanced, or thorough");
			result.profile = profile;
			continue;
		}
		throw new Error(`Unknown /team option: ${token}`);
	}
	return result;
}

/** Apply a parsed `/team` command to session state, returning a new state object.
 *  `status` leaves `state` unchanged; `on`/`off`/`once` set the mode. Pure: input is not mutated. */
export function applyParsedCommand(state: SessionTeamMode, parsed: ParseResult): SessionTeamMode {
	const next: SessionTeamMode = {
		...state,
		...(parsed.topology ? { topology: parsed.topology } : {}),
		...(parsed.maxModels !== undefined ? { maxModels: parsed.maxModels, maxModelsExplicit: true } : {}),
		...(parsed.profile ? { profile: parsed.profile } : {}),
		...(parsed.prompt ? { prompt: parsed.prompt } : {}),
	};
	if (parsed.action === "on" || parsed.action === "auto" || parsed.action === "off" || parsed.action === "once") {
		next.state = parsed.action;
	}
	return next;
}

function fusionPanelSize(state: SessionTeamMode): number {
	const configured = state.maxModelsExplicit === false ? resolveTeamProfile(state.profile).fusionPanelModels : state.maxModels;
	return Math.min(configured, OVERRIDE_MAX_MODELS);
}

/** Human-readable estimate of model calls a `/team` run will make for the active
 *  topology. `maxModels` caps the fusion-analysis panel size, not total calls. Pure. */
export function estimatedCallDescription(state: SessionTeamMode): string {
	if (state.topology === "navigator") return "1 model call (one focused review)";
	if (state.topology === "llm-council") return "members + critiques + synthesis (debate; multiple calls)";
	return `${fusionPanelSize(state)} panel + judge (direct answer with structured diagnostics)`;
}

function statusLine(state: SessionTeamMode): string {
	return `team mode: ${state.state} topology=${state.topology} profile=${state.profile ?? "balanced"} maxModels=${state.maxModelsExplicit === false ? "profile" : state.maxModels} calls=${estimatedCallDescription(state)} approved=${state.approved ? "yes" : "no"}`;
}

function shouldBypass(text: string, source: string | undefined): boolean {
	const trimmed = text.trim();
	return source === "extension" || trimmed.length === 0 || trimmed.startsWith("/") || trimmed.includes("team_run") || trimmed.startsWith("[Team ");
}

function topologyInstruction(state: SessionTeamMode): string {
	if (state.topology === "navigator") return `Use team_run with id="navigator" and profile="${state.profile ?? "balanced"}" for one focused review, then answer from the synthesis first.`;
	if (state.topology === "llm-council") return `Use team_run with id="llm-council" and profile="${state.profile ?? "balanced"}" for bounded debate, then answer from the synthesis first.`;
	const legacyLimit = state.maxModelsExplicit === false ? "" : ` and limits.maxLoops=${fusionPanelSize(state)}`;
	return `Use team_run with id="fusion-analysis", profile="${state.profile ?? "balanced"}"${legacyLimit} for bounded multi-model deliberation. The team returns structured JSON analysis including answer, consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, and missingEvidence.`;
}

export function buildAutoModePrompt(text: string, state: SessionTeamMode): string {
	return [
		"Team auto mode is enabled for this single user prompt.",
		topologyInstruction(state),
		"Use the team route only if the prompt warrants deliberation. If it does not, answer directly.",
		"Fail closed: if the team run cannot safely start, answer directly and say team mode was bypassed.",
		"Do not expose raw panel/debate trace by default. Give the synthesized answer first. Only include details if the user explicitly asks for expand, trace, or diagnostics.",
		"Do not send secrets, private session data, or unnecessary large context into team calls.",
		"",
		"User prompt:",
		text,
	].join("\n");
}

/** Classify a team run outcome from its result details. Pure. */
export function classifyTeamOutcome(details: TeamRunOutcomeDetails): { status: "ok" | "partial" | "failed"; failedCount: number } {
	const nodes = details.nodes ?? [];
	const failedCount = nodes.filter((node) => !node.ok).length;
	if (details.failureReason || details.stopped) return { status: "failed", failedCount };
	if (details.degraded || failedCount > 0) return { status: "partial", failedCount };
	return { status: "ok", failedCount };
}

function directTeamResultBody(teamId: string, body: string): string {
	if (teamId !== "fusion-analysis") return body;
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed !== "object" || parsed === null) return body;
		const answer = (parsed as Record<string, unknown>).answer;
		return typeof answer === "string" && answer.trim().length > 0 ? answer.trim() : body;
	} catch {
		return body;
	}
}

/** Format the user-facing follow-up for a forced (`/team once`) run. Pure. */
export function formatTeamModeResult(teamId: string, details: TeamRunOutcomeDetails, body: string): string {
	const { status, failedCount } = classifyTeamOutcome(details);
	const calls = details.nodes?.length ?? 0;
	const header = `[Team "${teamId}" result — status: ${status} · calls: ${calls}${failedCount > 0 ? ` · failed: ${failedCount}` : ""}]`;
	const tail = status === "ok" ? "" : `\n\n_Degraded run. Ask for "trace" for per-model details._`;
	return `${header}\n\n${directTeamResultBody(teamId, body)}${tail}`;
}

/** Format the user-facing follow-up when a forced run errors (fail-closed). Pure. */
export function formatTeamModeError(teamId: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `[Team "${teamId}" failed — team mode bypassed]\n\n${message}\n\n_Re-ask your prompt to answer directly, or run /team off._`;
}

async function approvalOk(ctx: { hasUI?: boolean; ui?: { confirm?: (title: string, message: string) => Promise<boolean>; notify?: (message: string, level?: "info" | "warning" | "error") => void } }, state: SessionTeamMode, text: string): Promise<boolean> {
	if (!ctx.hasUI || !ctx.ui?.confirm) return false;
	if (!state.approved) {
		const ok = await ctx.ui.confirm("Enable team mode for this session?", "Team mode may fan out to multiple model calls. It is session-only and can be disabled with /team off.");
		if (!ok) return false;
		state.approved = true;
	}
	if (state.maxModels > DEFAULT_MAX_MODELS) {
		return ctx.ui.confirm("Approve larger team fanout?", `This run may use ${estimatedCallDescription(state)}. Continue?`);
	}
	if (text.length > LARGE_CONTEXT_CHARS) {
		return ctx.ui.confirm("Approve large-context team prompt?", "This prompt is large; team fanout may multiply cost and data exposure. Continue?");
	}
	return true;
}

/** Build the run params for a forced `/team once` or deterministic `/team on` run. Pure. */
function forcedRunParams(state: SessionTeamMode, prompt: string, ctx: ExtensionContext): { id: string; prompt: string; profile: TeamProfile; limits?: { maxLoops: number } } {
	const profile = state.profile ?? "balanced";
	const contextualPrompt = buildTeamContext(ctx, prompt, profile);
	return {
		id: state.topology,
		prompt: contextualPrompt,
		profile,
		...(state.maxModelsExplicit === false ? {} : { limits: { maxLoops: fusionPanelSize(state) } }),
	};
}

export function registerTeamSessionMode(pi: ExtensionAPI, registration: TeamRunRegistration): void {
	const state = defaultState();
	let inFlight = false;
	pi.registerCommand("team", {
		description: "Session-only team mode: /team on|auto|off|status|once [prompt] [--topology ...] [--profile fast|balanced|thorough] [--max-models 1-5].",
		handler: async (rawArgs, ctx) => {
			try {
				const parsed = parseTeamModeArgs(rawArgs);
				Object.assign(state, applyParsedCommand(state, parsed));
				ctx.ui.notify(statusLine(state), "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
	pi.on("input", async (event, ctx: ExtensionContext) => {
		if (state.state === "off" || shouldBypass(event.text, event.source) || inFlight) return { action: "continue" as const };
		const pendingPrompt = state.prompt;
		delete state.prompt;
		const promptText = pendingPrompt ?? event.text;
		const ok = await approvalOk(ctx, state, promptText);
		const wasOnce = state.state === "once";
		const wasAuto = state.state === "auto";
		if (wasOnce) state.state = "off";
		if (!ok) {
			ctx.ui?.notify?.("team mode bypassed", "warning");
			return { action: "continue" as const };
		}
		// `/team auto` = assistant-mediated transform (model decides when to call team_run).
		if (wasAuto) return { action: "transform" as const, text: buildAutoModePrompt(event.text, state), images: event.images };
		// `/team on` = deterministic: every prompt is forced through the team.
		inFlight = true;
		const teamId = state.topology;
		const params = forcedRunParams(state, promptText, ctx);
		void runTeam({ params, ctx, stateManager: registration.stateManager, runtime: registration.runtime })
			.then((result) => pi.sendUserMessage(
				formatTeamModeResult(teamId, result.details as TeamRunOutcomeDetails, result.content.map((entry) => entry.text).join("\n")),
				{ deliverAs: "followUp" },
			))
			.catch((error: unknown) => pi.sendUserMessage(formatTeamModeError(teamId, error), { deliverAs: "followUp" }))
			.finally(() => { inFlight = false; });
		return pendingPrompt ? { action: "handled" as const, text: promptText, images: event.images } : { action: "handled" as const };
	});
}

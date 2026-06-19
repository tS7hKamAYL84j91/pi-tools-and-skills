/** Session-only `/team` interaction mode for synthesis-first team assistance. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type TeamModeState = "off" | "on" | "once";
type TeamRoute = "router-fusion" | "llm-council" | "navigator";

interface SessionTeamMode {
	state: TeamModeState;
	topology: TeamRoute;
	maxModels: number;
	approved: boolean;
}

interface ParseResult {
	action: "on" | "off" | "once" | "status";
	topology?: TeamRoute;
	maxModels?: number;
}

const DEFAULT_TOPOLOGY: TeamRoute = "router-fusion";
const DEFAULT_MAX_MODELS = 2;
const OVERRIDE_MAX_MODELS = 3;
const HARD_MAX_MODELS = 5;
const LARGE_CONTEXT_CHARS = 12_000;

function defaultState(): SessionTeamMode {
	return { state: "off", topology: DEFAULT_TOPOLOGY, maxModels: DEFAULT_MAX_MODELS, approved: false };
}

function isTopology(value: string): value is TeamRoute {
	return value === "router-fusion" || value === "llm-council" || value === "navigator";
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseTeamModeArgs(rawArgs: string): ParseResult {
	const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
	const command = tokens.shift() ?? "status";
	if (command !== "on" && command !== "off" && command !== "once" && command !== "status") {
		throw new Error("Usage: /team on|off|status|once [--topology router-fusion|llm-council|navigator] [--max-models 1-5]");
	}
	const result: ParseResult = { action: command };
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--topology") {
			const topology = tokens[++index];
			if (!topology || !isTopology(topology)) throw new Error("--topology must be router-fusion, llm-council, or navigator");
			result.topology = topology;
			continue;
		}
		if (token === "--max-models") {
			const maxModels = parsePositiveInt(tokens[++index]);
			if (maxModels === undefined || maxModels > HARD_MAX_MODELS) throw new Error("--max-models must be an integer from 1 to 5");
			result.maxModels = maxModels;
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
		...(parsed.maxModels !== undefined ? { maxModels: parsed.maxModels } : {}),
	};
	if (parsed.action === "on" || parsed.action === "off" || parsed.action === "once") {
		next.state = parsed.action;
	}
	return next;
}

function fusionPanelSize(state: SessionTeamMode): number {
	return Math.min(state.maxModels, OVERRIDE_MAX_MODELS);
}

/** Human-readable estimate of model calls a `/team` run will make for the active
 *  topology. `maxModels` caps the router-fusion panel size, not total calls. Pure. */
export function estimatedCallDescription(state: SessionTeamMode): string {
	if (state.topology === "navigator") return "1 model call (one focused review)";
	if (state.topology === "llm-council") return "members + critiques + synthesis (debate; multiple calls)";
	return `${fusionPanelSize(state)} panel + judge + synthesis`;
}

function statusLine(state: SessionTeamMode): string {
	return `team mode: ${state.state} topology=${state.topology} maxModels=${state.maxModels} calls=${estimatedCallDescription(state)} approved=${state.approved ? "yes" : "no"}`;
}

function shouldBypass(text: string, source: string | undefined): boolean {
	const trimmed = text.trim();
	return source === "extension" || trimmed.length === 0 || trimmed.startsWith("/") || trimmed.includes("team_run") || trimmed.startsWith("[Team ");
}

function topologyInstruction(state: SessionTeamMode): string {
	if (state.topology === "navigator") return "Use team_run with id=\"navigator\" for one focused review, then answer from the synthesis first.";
	if (state.topology === "llm-council") return "Use team_run with id=\"llm-council\" for bounded debate, then answer from the synthesis first.";
	return `Use team_run with id="router-fusion" and limits.maxLoops=${Math.min(state.maxModels, OVERRIDE_MAX_MODELS)} for a bounded fusion panel, then answer from the synthesis first.`;
}

export function buildTeamModePrompt(text: string, state: SessionTeamMode): string {
	return [
		"Team interaction mode is enabled for this single user prompt.",
		topologyInstruction(state),
		"Fail closed: if the team run cannot safely start, answer directly and say team mode was bypassed.",
		"Do not expose raw panel/debate trace by default. Give the synthesized answer first. Only include details if the user explicitly asks for expand, trace, or diagnostics.",
		"Do not send secrets, private session data, or unnecessary large context into team calls.",
		"",
		"User prompt:",
		text,
	].join("\n");
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

export function registerTeamSessionMode(pi: ExtensionAPI): void {
	const state = defaultState();
	pi.registerCommand("team", {
		description: "Session-only team interaction mode: /team on|off|status|once [--topology router-fusion|llm-council|navigator] [--max-models 1-5]",
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
	pi.on("input", async (event, ctx) => {
		if (state.state === "off" || shouldBypass(event.text, event.source)) return { action: "continue" as const };
		const ok = await approvalOk(ctx, state, event.text);
		if (state.state === "once") state.state = "off";
		if (!ok) {
			ctx.ui?.notify?.("team mode bypassed", "warning");
			return { action: "continue" as const };
		}
		return { action: "transform" as const, text: buildTeamModePrompt(event.text, state), images: event.images };
	});
}

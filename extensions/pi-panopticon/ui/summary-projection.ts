/**
 * Panopticon session/team work-summary projection for the agent detail view.
 *
 * Sources panopticon-owned data only: the registry AgentRecord, session log,
 * and (advisory) MEMORY.md snapshot state. No imports from other extensions.
 */
import type { AgentRecord } from "../types.js";
import type { SessionEvent } from "../../../lib/session-log.js";

/** Work summary extracted from panopticon-visible signals. */
export interface WorkSummary {
	/** Brief task or spawn goal, when present. */
	briefGoal?: string;
	/** Sources consulted, derived from tool_result/tool_call activity. */
	sources: string[];
	/** Artifacts produced, derived from file-related tool results. */
	artifacts: string[];
	/** Latest verification/check result, if any. */
	lastCheck?: { tool: string; summary: string; ok: boolean };
}

const KNOWN_SOURCE_TOOLS = new Set([
	"read",
	"bash",
	"web_search",
	"web_fetch",
	"agent_peek",
	"agent_status",
	"message_read",
	"team_run",
	"swarm_run",
]);

const KNOWN_ARTIFACT_TOOLS = new Set([
	"write",
	"edit",
	"venice_image_generate",
	"venice_video_generate",
]);

function isSourceTool(tool?: string): boolean {
	if (!tool) return false;
	return KNOWN_SOURCE_TOOLS.has(tool);
}

function isArtifactTool(tool?: string): boolean {
	if (!tool) return false;
	return KNOWN_ARTIFACT_TOOLS.has(tool);
}

function extractFirstArg(args?: string): string {
	if (!args) return "";
	return args.split(/\s+/u)[0] ?? "";
}

function truncate(value: string, max = 40): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

/**
 * Project a concise work summary from panopticon-owned agent signals.
 * Uses only the registry record and session events; no cross-extension imports.
 */
export function projectWorkSummary(
	record: AgentRecord,
	sessionEvents: SessionEvent[],
): WorkSummary {
	const briefGoal = record.task?.slice(0, 120) || undefined;
	const sources: string[] = [];
	const artifacts: string[] = [];
	let lastCheck: WorkSummary["lastCheck"] | undefined;

	for (const event of sessionEvents) {
		if (event.event === "tool_call" && isSourceTool(String(event.tool))) {
			sources.push(`${String(event.tool)}:${truncate(extractFirstArg(String(event.args)))}`);
		} else if (event.event === "tool_result" && isArtifactTool(String(event.tool))) {
			artifacts.push(truncate(String(event.summary ?? event.tool ?? "?")));
		} else if (event.event === "tool_result" && String(event.tool).includes("check")) {
			lastCheck = {
				tool: String(event.tool),
				summary: truncate(String(event.summary ?? "")),
				ok: event.isError !== true && !String(event.summary).match(/fail|error/i),
			};
		}
	}

	return {
		briefGoal,
		sources: dedupe(sources.slice(-8)),
		artifacts: dedupe(artifacts.slice(-8)),
		lastCheck,
	};
}

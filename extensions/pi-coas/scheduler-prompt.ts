/**
 * Prompt rendering and agent-turn message extraction for scheduled runs.
 */
import type { ScheduleEntry } from "./types.js";
import type { PriorSummary, ScheduleRunState } from "./scheduler-run-state.js";
import { isoUtc } from "./store-paths.js";

const MAX_SUMMARY_CHARS = 500;
const MAX_NEXT_ACTION_CHARS = 200;

function scheduleRunMarker(taskId: string, runId: string): string {
	return `<!-- coas-scheduled-run taskId="${taskId}" runId="${runId}" -->`;
}

function extractScheduledRunMarker(text: string): { taskId: string; runId: string } | undefined {
	const match = text.match(/<!--\s*coas-scheduled-run\s+taskId="([^"]+)"\s+runId="([^"]+)"\s*-->/);
	if (!match) return undefined;
	return { taskId: match[1] ?? "", runId: match[2] ?? "" };
}

export function findScheduledRunMarker(messages: readonly unknown[]): { taskId: string; runId: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!message || typeof message !== "object") continue;
		const text = extractTextContent(message as Record<string, unknown>);
		if (text) {
			const marker = extractScheduledRunMarker(text);
			if (marker) return marker;
		}
	}
	return undefined;
}

export function renderScheduledPrompt(schedule: ScheduleEntry, priorSummary?: PriorSummary): string {
	const continuationHeader = priorSummary
		? `Continuing from prior scheduled run ${priorSummary.runId}.\n\n${priorSummary.text}\n\n---\n\n`
		: "";
	return [
		`${continuationHeader}CoAS scheduled task: ${schedule.taskName} (${schedule.taskId})`,
		`Workspace: ${schedule.workspaceId}`,
		`Room: ${schedule.roomId || "(none)"}`,
		"",
		"Run the following scheduled CoAS prompt. Use CoAS workspace tools when useful, and record durable non-secret outcomes with coas_workspace_update.",
		"",
		schedule.prompt?.trim() ?? "",
	].join("\n");
}

export function renderPromptWithMarker(schedule: ScheduleEntry, runId: string, priorSummary?: PriorSummary): string {
	const marker = scheduleRunMarker(schedule.taskId, runId);
	const prompt = renderScheduledPrompt(schedule, priorSummary);
	return `${prompt}\n\n${marker}`;
}

function findFinalAssistantMessage(messages: readonly unknown[]): { role: string; stopReason?: string; errorMessage?: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || typeof m !== "object") continue;
		const c = m as Record<string, unknown>;
		if (c.role !== "assistant") continue;
		return {
			role: "assistant",
			stopReason: typeof c.stopReason === "string" ? c.stopReason : undefined,
			errorMessage: typeof c.errorMessage === "string" ? c.errorMessage : undefined,
		};
	}
	return undefined;
}

function extractTextContent(message: Record<string, unknown>): string | undefined {
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return message.content
			.map((block) => {
				if (!block || typeof block !== "object") return "";
				const b = block as Record<string, unknown>;
				return typeof b.text === "string" ? b.text : "";
			})
			.join("");
	}
	return undefined;
}

function extractBoundedSummary(messages: readonly unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || typeof m !== "object") continue;
		const c = m as Record<string, unknown>;
		if (c.role !== "assistant") continue;
		const text = extractTextContent(c);
		if (!text) continue;
		const done = text.match(/(?:^|\n)(DONE|BLOCKED):\s*(.+?)(?:\n|$)/);
		if (done?.[2]) return done[2].trim().slice(0, MAX_SUMMARY_CHARS);
		return text.trim().slice(0, MAX_SUMMARY_CHARS);
	}
	return "";
}

function extractNextAction(messages: readonly unknown[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || typeof m !== "object") continue;
		const c = m as Record<string, unknown>;
		if (c.role !== "assistant") continue;
		const text = extractTextContent(c);
		if (!text) continue;
		const next = text.match(/(?:^|\n)NEXT:\s*(.+?)(?:\n|$)/);
		if (next?.[1]) return next[1].trim().slice(0, MAX_NEXT_ACTION_CHARS);
	}
	return undefined;
}


/** Builds the terminal run-state record persisted when a scheduled agent turn ends. */
export function runStateFromAgentEnd(
	taskId: string,
	runId: string,
	startedAt: string,
	messages: readonly unknown[],
): ScheduleRunState & { readonly status: "complete" | "interrupted" } {
	const finalAssistant = findFinalAssistantMessage(messages);
	const status: "complete" | "interrupted" =
		finalAssistant && (finalAssistant.stopReason === "aborted" || finalAssistant.stopReason === "error")
			? "interrupted"
			: "complete";
	const summary = status === "complete"
		? extractBoundedSummary(messages)
		: `Run interrupted: ${finalAssistant?.errorMessage ?? "unknown reason"}`;
	const nextAction = status === "complete" ? extractNextAction(messages) : undefined;
	const now = isoUtc();
	return {
		taskId,
		runId,
		status,
		startedAt,
		completedAt: now,
		summary,
		nextAction,
		lastUpdatedAt: now,
	};
}
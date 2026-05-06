/**
 * Spawn events — formatters and inspectors for a SpawnedAgent's event stream.
 *
 * Pure functions. Used by tool wrappers to render status, and by lifecycle
 * managers to detect completion signals when an agent exits.
 */

import { parseCompletionSignal } from "./completion-signal.js";
import type { SpawnedAgent } from "./spawn-service.js";

type Evt = Record<string, unknown>;

function parseEvent(line: string): Evt | undefined {
	try {
		return JSON.parse(line) as Evt;
	} catch {
		return undefined;
	}
}

function lineMightContainSignal(line: string): boolean {
	return (
		line.includes("DONE ") ||
		line.includes("BLOCKED ") ||
		line.includes("FAILED ") ||
		line.includes("<completion-signal>")
	);
}

const EVENT_FORMATTERS: Record<string, (e: Evt) => string> = {
	message_update: (e) => {
		const d = e.assistantMessageEvent as Evt | undefined;
		return d?.type === "text_delta" ? String(d.delta) : "";
	},
	tool_execution_start: (e) =>
		`\n⚙ ${e.toolName}(${JSON.stringify(e.args ?? {}).slice(0, 80)})`,
	tool_execution_end: (e) => {
		const text = (e.result as Evt | undefined)?.content;
		const first = Array.isArray(text)
			? (text[0] as Evt | undefined)?.text
			: undefined;
		return `  → ${String(first ?? "(done)").slice(0, 100)}`;
	},
	agent_start: () => "\n▶ agent started",
	agent_end: () => "\n■ agent finished",
	response: (e) => `  [${e.command}: ${e.success ? "ok" : e.error}]`,
};

/** Format a single JSONL event line into a compact human-readable string. */
export function formatEvent(line: string): string {
	const evt = parseEvent(line);
	if (!evt) {
		return line.slice(0, 120);
	}
	const fmt = EVENT_FORMATTERS[String(evt.type ?? "?")];
	return fmt ? fmt(evt) : `  [${evt.type ?? "?"}]`;
}

/** Format the last `lines` events from an array into readable output. */
export function recentOutputFromEvents(events: string[], lines = 20): string {
	if (events.length === 0) return "(no events yet)";
	return events.slice(-lines).map(formatEvent).filter(Boolean).join("");
}

function toolResultText(evt: Evt): string | undefined {
	const result = evt.result as Evt | undefined;
	const content = result?.content as Array<{ text?: string }> | undefined;
	return content?.[0]?.text;
}

function agentSendMessage(evt: Evt): string | undefined {
	const args = evt.args as Evt | undefined;
	return args?.message as string | undefined;
}

function eventCompletionText(evt: Evt): string | undefined {
	if (evt.type === "tool_execution_end") {
		return toolResultText(evt);
	}
	if (evt.type === "tool_execution_start" && evt.toolName === "agent_send") {
		return agentSendMessage(evt);
	}
	return undefined;
}

function eventHasCompletionSignal(line: string): boolean {
	if (!lineMightContainSignal(line)) {
		return false;
	}
	const evt = parseEvent(line);
	const text = evt ? eventCompletionText(evt) : undefined;
	return Boolean(text && parseCompletionSignal(text));
}

/** Scan agent events for any completion signal (structured or legacy). */
export function hasCompletionSignal(
	agent: SpawnedAgent,
	signalledAgents: Set<string>,
): boolean {
	if (signalledAgents.has(agent.name)) return true;
	if (!agent.recentEvents.some(eventHasCompletionSignal)) return false;
	signalledAgents.add(agent.name);
	return true;
}

/**
 * Session JSONL reader — pure functions for reading pi session logs.
 *
 * Pi writes session JSONL to `~/.pi/agent/sessions/…/*.jsonl`.
 * This module reads and formats those logs without any transport dependency.
 */

import { existsSync, readFileSync } from "node:fs";

// ── Types ───────────────────────────────────────────────────────

export interface SessionEvent {
	ts: number;
	event: string;
	[key: string]: unknown;
}

// ── Readers ─────────────────────────────────────────────────────

/** Read the tail of a session JSONL file and extract events in compact format. */
export function readSessionLog(sessionFile: string, count: number): SessionEvent[] {
	const events: SessionEvent[] = [];
	try {
		if (!existsSync(sessionFile)) return events;
		const content = readFileSync(sessionFile, "utf-8");
		const lines = content.split("\n").filter((l) => l.trim());
		const recent = lines.slice(-count);
		for (const line of recent) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message) {
					const msg = entry.message as { role?: string; content?: unknown[]; timestamp?: number };
					const ts = msg.timestamp ?? entry.ts ?? Date.now();
					const role = msg.role ?? "?";
					if (Array.isArray(msg.content)) {
						for (const block of msg.content) {
							if (!block || typeof block !== "object") continue;
							const b = block as { type?: string; name?: string; text?: string; input?: unknown; content?: unknown[]; isError?: boolean; id?: string };
							if (b.type === "text" && b.text) {
								events.push({ ts, event: "message", role, text: b.text.slice(0, 100) });
							} else if (b.type === "toolCall") {
								const argsPreview = b.input ? JSON.stringify(b.input).slice(0, 100) : "";
								events.push({ ts, event: "tool_call", tool: b.name, args: argsPreview, id: b.id });
							} else if (b.type === "toolResult") {
								const summary = b.content
									? b.content.map((c: unknown) => { const obj = c as { type: string; text?: string }; return obj.type === "text" ? obj.text ?? "" : `[${obj.type}]`; }).join(" ").slice(0, 100)
									: "";
								events.push({ ts, event: "tool_result", tool: b.name, summary, isError: b.isError, id: b.id });
							}
						}
					} else {
						events.push({ ts, event: "message", role });
					}
				} else if (entry.type === "session") {
					events.push({ ts: entry.timestamp ?? Date.now(), event: "session_start", id: entry.id, cwd: entry.cwd });
				} else if (entry.type === "model_change") {
					events.push({ ts: entry.timestamp ?? Date.now(), event: "model_change", model: entry.model });
				}
			} catch { /* skip malformed lines */ }
		}
	} catch { /* best-effort */ }
	return events;
}

// ── Formatters ──────────────────────────────────────────────────

/** Format session events into compact `[HH:MM:SS] event_type key=value...` format. */
export function formatSessionLog(events: SessionEvent[]): string {
	if (events.length === 0) return "(no activity recorded yet)";
	return events.map((e) => {
		const ts = new Date(e.ts).toISOString().slice(11, 19);
		const parts: string[] = [];
		if (e.event === "message") {
			parts.push(`role=${e.role}`);
			if (e.text) parts.push(`text="${e.text}"`);
		} else if (e.event === "tool_call") {
			parts.push(`tool=${e.tool}`);
			if (e.args) parts.push(`args=${e.args}`);
		} else if (e.event === "tool_result") {
			parts.push(`tool=${e.tool}`);
			if (e.summary) parts.push(`summary="${e.summary}"`);
			if (e.isError) parts.push(`error`);
		} else if (e.event === "session_start") {
			if (e.cwd) parts.push(`cwd=${e.cwd}`);
		} else if (e.event === "model_change") {
			parts.push(`model=${e.model}`);
		}
		return `[${ts}] ${e.event} ${parts.join(" ")}`;
	}).join("\n");
}

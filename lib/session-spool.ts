/** Opt-in session export spooling into Panopticon-compatible fixture records. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRecord } from "./agent-registry.js";
import { sessionEntriesToJournal, type JournalEvent } from "./session-journal.js";

const DEFAULT_ALLOWED_EVENT_TYPES = new Set<JournalEvent["type"]>(["message", "tool_call", "tool_result", "session", "model_change", "custom"]);
const MAX_SPOOLED_EVENTS = 100;

/** @public */
export interface SessionSpoolOptions {
	enabled: boolean;
	registryDir: string;
	agentId: string;
	name: string;
	cwd: string;
	entries: readonly unknown[];
	allowedEventTypes?: readonly JournalEvent["type"][];
	maxEvents?: number;
	now?: number;
}

/** @public */
export interface SessionSpoolResult {
	spooled: boolean;
	agentId: string;
	registryPath?: string;
	sessionFile?: string;
	eventsWritten: number;
	omitted: number;
}

function safeName(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80) || "session-spool";
}

function boundedEvents(events: readonly JournalEvent[], maxEvents: number): JournalEvent[] {
	const limit = Math.max(0, Math.min(Math.trunc(maxEvents), MAX_SPOOLED_EVENTS));
	return events.slice(-limit);
}

function toSessionJsonlEvent(event: JournalEvent): Record<string, unknown> {
	const timestamp = event.timestamp ?? Date.now();
	if (event.type === "tool_call") {
		return { message: { role: event.role ?? "assistant", timestamp, content: [{ type: "toolCall", name: event.name ?? "session_spool", input: { summary: event.summary } }] } };
	}
	if (event.type === "tool_result") {
		return { message: { role: event.role ?? "tool", timestamp, content: [{ type: "toolResult", name: event.name ?? "session_spool", content: [{ type: "text", text: event.summary }] }] } };
	}
	return { message: { role: event.role ?? "system", timestamp, content: [{ type: "text", text: `${event.type}: ${event.summary}` }] } };
}

/**
 * Write a Panopticon-compatible registry record and redacted session JSONL.
 * This is off-by-default and intended for synthetic/redacted fixtures or an
 * explicitly approved hook boundary; it never reads session files itself.
 */
export async function spoolSessionEntries(options: SessionSpoolOptions): Promise<SessionSpoolResult> {
	if (!options.enabled) {
		return { spooled: false, agentId: options.agentId, eventsWritten: 0, omitted: 0 };
	}
	const now = options.now ?? Date.now();
	const allowed = new Set(options.allowedEventTypes ?? DEFAULT_ALLOWED_EVENT_TYPES);
	const journal = sessionEntriesToJournal(options.entries, `${options.name} activity`);
	const events = boundedEvents(journal.events.filter((event) => allowed.has(event.type)), options.maxEvents ?? MAX_SPOOLED_EVENTS);
	const agentId = safeName(options.agentId);
	const agentDir = join(options.registryDir, agentId);
	const sessionFile = join(agentDir, "session.jsonl");
	const registryPath = join(options.registryDir, `${agentId}.json`);
	await mkdir(agentDir, { recursive: true });
	const jsonl = `${events.map((event) => JSON.stringify(toSessionJsonlEvent(event))).join("\n")}\n`;
	await writeFile(sessionFile, jsonl, "utf8");
	const record: AgentRecord = {
		id: agentId,
		name: safeName(options.name),
		name_source: "programmatic",
		pid: process.pid,
		cwd: options.cwd,
		model: "claude-code/session-spool",
		startedAt: now,
		heartbeat: now,
		status: "waiting",
		visibility: "scoped",
		sessionFile,
	};
	await writeFile(registryPath, JSON.stringify(record, null, 2), "utf8");
	return { spooled: true, agentId, registryPath, sessionFile, eventsWritten: events.length, omitted: journal.omitted + (journal.events.length - events.length) };
}

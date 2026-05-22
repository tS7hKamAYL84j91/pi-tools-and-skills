/** Safe session journal extraction for synthetic/redacted pi session exports. */

export const SESSION_JOURNAL_SCHEMA_VERSION = 1;
const MAX_TEXT_CHARS = 240;
const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";

const SECRET_PATTERNS: readonly RegExp[] = [
	/\b(?:sk|pk)_[A-Za-z0-9_-]{12,}\b/g,
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
	/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
];

const PRIVATE_KEYS = new Set(["reasoning", "thinking", "chain_of_thought", "hidden", "private", "raw", "rawMessage", "rawPayload"]);
const SAFE_TYPES = new Set(["message", "tool_call", "tool_result", "session", "model_change", "custom"]);

/** @public */
export interface JournalEvent {
	type: "message" | "tool_call" | "tool_result" | "session" | "model_change" | "custom" | "unknown";
	timestamp?: number;
	role?: string;
	name?: string;
	summary: string;
}

/** @public */
export interface JournalDocument {
	schemaVersion: typeof SESSION_JOURNAL_SCHEMA_VERSION;
	title: string;
	events: JournalEvent[];
	omitted: number;
}

function redactText(value: string): string {
	let redacted = value;
	for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTED);
	return redacted.length > MAX_TEXT_CHARS ? `${redacted.slice(0, MAX_TEXT_CHARS)}…` : redacted;
}

function safeString(value: unknown): string | undefined {
	return typeof value === "string" ? redactText(value) : undefined;
}

function summarizeValue(value: unknown): string {
	if (typeof value === "string") return redactText(value);
	if (value === null || value === undefined) return "";
	if (typeof value !== "object") return redactText(String(value));
	if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"} omitted]`;
	const parts: string[] = [];
	for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 8)) {
		if (PRIVATE_KEYS.has(key)) {
			parts.push(`${key}=${OMITTED}`);
		} else if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
			parts.push(`${key}=${redactText(String(entry))}`);
		} else {
			parts.push(`${key}=${OMITTED}`);
		}
	}
	return parts.join(" ");
}

function blockText(block: Record<string, unknown>): string | undefined {
	if (typeof block.text === "string") return block.text;
	if (typeof block.content === "string") return block.content;
	return undefined;
}

function fromMessage(entry: Record<string, unknown>): JournalEvent[] {
	const message = entry.message;
	if (message === null || typeof message !== "object") return [];
	const msg = message as Record<string, unknown>;
	const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : typeof entry.ts === "number" ? entry.ts : undefined;
	const role = safeString(msg.role) ?? "unknown";
	const content = msg.content;
	if (!Array.isArray(content)) return [{ type: "message", timestamp, role, summary: "message content omitted" }];
	const events: JournalEvent[] = [];
	for (const rawBlock of content) {
		if (rawBlock === null || typeof rawBlock !== "object") continue;
		const block = rawBlock as Record<string, unknown>;
		const type = block.type;
		if (type === "text") {
			events.push({ type: "message", timestamp, role, summary: redactText(blockText(block) ?? "") });
		} else if (type === "toolCall" || type === "tool_use") {
			events.push({ type: "tool_call", timestamp, role, name: safeString(block.name) ?? "unknown", summary: summarizeValue(block.input) });
		} else if (type === "toolResult" || type === "tool_result") {
			events.push({ type: "tool_result", timestamp, role, name: safeString(block.name) ?? "unknown", summary: summarizeValue(block.content) });
		}
	}
	return events;
}

/** Convert parsed session entries into a redacted journal document. */
export function sessionEntriesToJournal(entries: readonly unknown[], title = "Session journal"): JournalDocument {
	const events: JournalEvent[] = [];
	let omitted = 0;
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") {
			omitted++;
			continue;
		}
		const record = entry as Record<string, unknown>;
		if (record.message) {
			events.push(...fromMessage(record));
			continue;
		}
		const type = typeof record.type === "string" && SAFE_TYPES.has(record.type) ? record.type : "unknown";
		const timestamp = typeof record.timestamp === "number" ? record.timestamp : typeof record.ts === "number" ? record.ts : undefined;
		if (type === "session") events.push({ type, timestamp, summary: `cwd=${safeString(record.cwd) ?? OMITTED}` });
		else if (type === "model_change") events.push({ type, timestamp, summary: `model=${safeString(record.model) ?? OMITTED}` });
		else if (type === "custom") events.push({ type, timestamp, name: safeString(record.customType), summary: summarizeValue(record.data) });
		else {
			omitted++;
			events.push({ type: "unknown", timestamp, summary: "unknown session event omitted" });
		}
	}
	return { schemaVersion: SESSION_JOURNAL_SCHEMA_VERSION, title: redactText(title), events, omitted };
}

/** Render a compact Markdown episodic journal. */
export function renderJournalMarkdown(journal: JournalDocument): string {
	const lines = [`# ${journal.title}`, "", `Schema: v${journal.schemaVersion}`, `Events: ${journal.events.length}`, `Omitted: ${journal.omitted}`, "", "## Timeline"];
	for (const event of journal.events) {
		const time = event.timestamp ? new Date(event.timestamp).toISOString() : "unknown-time";
		const role = event.role ? ` role=${event.role}` : "";
		const name = event.name ? ` name=${event.name}` : "";
		lines.push(`- ${time} ${event.type}${role}${name}: ${event.summary}`);
	}
	return `${lines.join("\n")}\n`;
}

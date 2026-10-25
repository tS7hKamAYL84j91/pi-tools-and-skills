/**
 * Cockpit transcript reducer.
 *
 * Pure projection of Pi's RPC/JSON event stream into display rows and run
 * state. No I/O, no timers, no terminal access — so behaviour is testable and
 * the UI layer stays a dumb renderer.
 *
 * Wire reconstruction follows the documented contract: `message_update` is
 * delta-only, `text_end`/`thinking_end`/`toolcall_end` carry authoritative
 * content, and `message_end.message` replaces the whole partial message.
 */
import type { RpcRecord } from "./rpc-client.ts";

export type TranscriptRole = "user" | "assistant" | "tool" | "system" | "error";

export interface ToolRow {
	toolCallId: string;
	name: string;
	/** Serialized arguments, single line, bounded by the renderer. */
	args: string;
	status: "running" | "ok" | "error";
	durationMs?: number;
}

export interface TranscriptRow {
	id: string;
	role: TranscriptRole;
	text: string;
	thinking: string;
	streaming: boolean;
	tool?: ToolRow;
}

interface QueuedInputs {
	steering: string[];
	followUp: string[];
}

interface RunState {
	/** A run is active (started, not yet settled). */
	streaming: boolean;
	/** Automatic retry in progress. */
	retrying: boolean;
	/** Compaction in progress. */
	compacting: boolean;
	queued: QueuedInputs;
	sessionName?: string;
	/** Last transport/extension/runtime error shown to the operator. */
	lastError?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Flatten a message's content blocks into visible text and thinking text. */
export function projectMessageContent(content: unknown): { text: string; thinking: string } {
	if (typeof content === "string") return { text: content, thinking: "" };
	if (!Array.isArray(content)) return { text: "", thinking: "" };
	const textParts: string[] = [];
	const thinkingParts: string[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (block.type === "text") textParts.push(asString(block.text));
		else if (block.type === "thinking") thinkingParts.push(asString(block.thinking));
	}
	return { text: textParts.join(""), thinking: thinkingParts.join("") };
}

function toolArgsPreview(args: unknown): string {
	if (args === undefined) return "";
	try {
		return JSON.stringify(args);
	} catch {
		return "[unserializable arguments]";
	}
}

export class CockpitTranscript {
	private readonly rows: TranscriptRow[] = [];
	private readonly state: RunState = {
		streaming: false,
		retrying: false,
		compacting: false,
		queued: { steering: [], followUp: [] },
	};
	private sequence = 0;
	/** Assistant row currently receiving deltas, keyed by content index. */
	private activeAssistant: TranscriptRow | undefined;
	private readonly toolRows = new Map<string, TranscriptRow>();

	get rowsView(): readonly TranscriptRow[] {
		return this.rows;
	}

	get runState(): Readonly<RunState> {
		return this.state;
	}

	private nextId(prefix: string): string {
		this.sequence += 1;
		return `${prefix}-${this.sequence}`;
	}

	private append(row: TranscriptRow): TranscriptRow {
		this.rows.push(row);
		return row;
	}

	/** Apply one protocol record. Unknown record types are ignored by design. */
	apply(record: RpcRecord): void {
		switch (record.type) {
			case "agent_start":
				this.state.streaming = true;
				this.state.lastError = undefined;
				return;
			case "agent_end":
				this.state.streaming = false;
				return;
			case "agent_settled":
				this.state.streaming = false;
				this.state.retrying = false;
				this.activeAssistant = undefined;
				return;
			case "turn_start":
				this.state.streaming = true;
				return;
			case "message_start":
				this.onMessageStart(record.message);
				return;
			case "message_update":
				this.onMessageUpdate(record.assistantMessageEvent);
				return;
			case "message_end":
				this.onMessageEnd(record.message);
				return;
			case "tool_execution_start":
				this.onToolStart(record);
				return;
			case "tool_execution_end":
				this.onToolEnd(record);
				return;
			case "queue_update":
				this.state.queued = {
					steering: asQueue(record.steering),
					followUp: asQueue(record.followUp),
				};
				return;
			case "session_info_changed":
				this.state.sessionName = typeof record.name === "string" ? record.name : undefined;
				return;
			case "compaction_start":
				this.state.compacting = true;
				return;
			case "compaction_end":
				this.state.compacting = false;
				if (typeof record.errorMessage === "string") {
					this.state.lastError = record.errorMessage;
				}
				return;
			case "auto_retry_start":
				this.state.retrying = true;
				return;
			case "auto_retry_end":
				this.state.retrying = false;
				if (record.success === false && typeof record.finalError === "string") {
					this.state.lastError = record.finalError;
				}
				return;
			case "extension_error":
				this.state.lastError = `${asString(record.extensionPath)}: ${asString(record.error)}`;
				return;
			default:
				return;
		}
	}

	/** Record a transport-level failure (parse error, disconnect, refused command). */
	noteError(message: string): void {
		this.state.lastError = message;
		this.append({
			id: this.nextId("error"),
			role: "error",
			text: message,
			thinking: "",
			streaming: false,
		});
	}

	/** Append an operator-visible note that is not agent output. */
	noteSystem(text: string): void {
		this.append({
			id: this.nextId("system"),
			role: "system",
			text,
			thinking: "",
			streaming: false,
		});
	}

	private onMessageStart(message: unknown): void {
		if (!isRecord(message)) return;
		const role = message.role;
		if (role === "user") {
			const { text } = projectMessageContent(message.content);
			this.append({
				id: this.nextId("user"),
				role: "user",
				text,
				thinking: "",
				streaming: false,
			});
			return;
		}
		if (role === "assistant") {
			this.activeAssistant = this.append({
				id: this.nextId("assistant"),
				role: "assistant",
				text: "",
				thinking: "",
				streaming: true,
			});
		}
	}

	private onMessageUpdate(update: unknown): void {
		if (!isRecord(update)) return;
		const row = this.activeAssistant;
		if (row === undefined) return;
		const delta = asString(update.delta);
		switch (update.type) {
			case "text_delta":
				row.text += delta;
				return;
			case "thinking_delta":
				row.thinking += delta;
				return;
			case "text_end":
				row.text = asString(update.content);
				return;
			case "thinking_end":
				row.thinking = asString(update.content);
				return;
			case "toolcall_end": {
				const call = update.toolCall;
				if (!isRecord(call)) return;
				const toolCallId = asString(call.id);
				const toolRow = this.append({
					id: this.nextId("tool"),
					role: "tool",
					text: "",
					thinking: "",
					streaming: true,
					tool: {
						toolCallId,
						name: asString(call.name),
						args: toolArgsPreview(call.arguments),
						status: "running",
					},
				});
				this.toolRows.set(toolCallId, toolRow);
				return;
			}
			default:
				return;
		}
	}

	private onMessageEnd(message: unknown): void {
		if (!isRecord(message)) return;
		const role = message.role;
		if (role !== "assistant") return;
		const row = this.activeAssistant;
		if (row !== undefined) {
			const { text, thinking } = projectMessageContent(message.content);
			// The completed message is authoritative over reconstructed deltas.
			if (text.length > 0) row.text = text;
			if (thinking.length > 0) row.thinking = thinking;
			row.streaming = false;
		}
		this.activeAssistant = undefined;
	}

	private onToolStart(record: RpcRecord): void {
		const toolCallId = asString(record.toolCallId);
		const existing = this.toolRows.get(toolCallId);
		if (existing !== undefined && existing.tool !== undefined) {
			existing.tool.status = "running";
			return;
		}
		const row = this.append({
			id: this.nextId("tool"),
			role: "tool",
			text: "",
			thinking: "",
			streaming: true,
			tool: {
				toolCallId,
				name: asString(record.toolName),
				args: toolArgsPreview(record.args),
				status: "running",
			},
		});
		this.toolRows.set(toolCallId, row);
	}

	private onToolEnd(record: RpcRecord): void {
		const toolCallId = asString(record.toolCallId);
		const row = this.toolRows.get(toolCallId);
		if (row === undefined || row.tool === undefined) return;
		row.streaming = false;
		row.tool.status = record.isError === true ? "error" : "ok";
		if (typeof record.durationMs === "number") row.tool.durationMs = record.durationMs;
		const { text } = projectMessageContent(
			isRecord(record.result) ? record.result.content : undefined,
		);
		row.text = text;
	}
}

function asQueue(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === "string" ? entry : "")).filter(Boolean);
}
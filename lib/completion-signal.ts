/**
 * Structured completion signals for agent-to-orchestrator communication.
 *
 * Replaces informal "DONE T-NNN — summary" / "BLOCKED T-NNN — reason"
 * prose with a typed JSON schema that enables automated monitoring,
 * metrics tracking, and artifact enumeration.
 *
 * Workers produce signals via formatCompletionSignal().
 * Orchestrators parse signals via parseCompletionSignal().
 *
 * The signal is still delivered as a text message via agent_send,
 * but the text body contains a parseable JSON block wrapped in
 * <completion-signal> tags for clean extraction.
 */

// ── Types ───────────────────────────────────────────────────────

export type CompletionStatus = "done" | "blocked" | "failed";

export interface CompletionSignal {
	/** Schema version for forward compatibility. */
	version: 1;
	/** Task ID (e.g. "T-260"). */
	taskId: string;
	/** Terminal status. */
	status: CompletionStatus;
	/** Human-readable summary of what was accomplished or why blocked/failed. */
	summary: string;
	/** List of files/artifacts produced or modified. */
	artifacts: string[];
	/** Wall-clock duration string (e.g. "12m", "2h", "45s"). */
	duration?: string;
	/** Token usage if available. */
	tokenUsage?: {
		input: number;
		output: number;
		total: number;
		cost?: number;
	};
	/** Reason for block/failure (only when status != "done"). */
	reason?: string;
}

// ── Format ──────────────────────────────────────────────────────

const SIGNAL_OPEN = "<completion-signal>";
const SIGNAL_CLOSE = "</completion-signal>";

/**
 * Format a completion signal as a message body suitable for agent_send.
 *
 * Produces a human-readable summary line followed by a parseable
 * JSON block in <completion-signal> tags.
 */
export function formatCompletionSignal(signal: CompletionSignal): string {
	const statusLabel = signal.status.toUpperCase();
	const headline = `${statusLabel} ${signal.taskId} — ${signal.summary}`;
	const json = JSON.stringify(signal);
	return `${headline}\n${SIGNAL_OPEN}\n${json}\n${SIGNAL_CLOSE}`;
}

// ── Parse ───────────────────────────────────────────────────────

/**
 * Attempt to parse a completion signal from a message body.
 *
 * Returns the parsed signal if found, or undefined if the message
 * does not contain a valid <completion-signal> block.
 *
 * Also handles legacy informal signals ("DONE T-NNN — summary")
 * by extracting what it can into the structured format.
 */
export function parseCompletionSignal(text: string): CompletionSignal | undefined {
	// Try structured signal first
	const tagStart = text.indexOf(SIGNAL_OPEN);
	const tagEnd = text.indexOf(SIGNAL_CLOSE);
	if (tagStart >= 0 && tagEnd > tagStart) {
		const jsonStr = text.slice(tagStart + SIGNAL_OPEN.length, tagEnd).trim();
		try {
			const parsed = JSON.parse(jsonStr) as CompletionSignal;
			if (parsed.version === 1 && parsed.taskId && parsed.status && parsed.summary) {
				return parsed;
			}
		} catch {
			// Malformed JSON — fall through to legacy parsing
		}
	}

	// Legacy informal signal: "DONE T-NNN — summary" or "BLOCKED T-NNN — reason"
	const legacyMatch = text.match(/^(DONE|BLOCKED|FAILED)\s+(T-\d+)\s*[-—]\s*(.+)/i);
	if (legacyMatch) {
		const statusMap: Record<string, CompletionStatus> = {
			done: "done",
			blocked: "blocked",
			failed: "failed",
		};
		const status = statusMap[legacyMatch[1]?.toLowerCase() ?? ""] ?? "done";
		const taskId = legacyMatch[2] ?? "";
		const summary = legacyMatch[3]?.trim() ?? "";
		return {
			version: 1,
			taskId,
			status,
			summary,
			artifacts: [],
			...(status !== "done" ? { reason: summary } : {}),
		};
	}

	return undefined;
}

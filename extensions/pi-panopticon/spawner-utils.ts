/**
 * Spawner utilities — Pure helpers for agent spawning.
 *
 * Event formatting, CLI arg building, and PI binary resolution.
 * No side effects, no state — used by spawner.ts.
 */

import { execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── PI binary ───────────────────────────────────────────────────

function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	if (existsSync(candidate)) return candidate;
	try {
		const resolved = execSync("which pi", { encoding: "utf-8" }).trim();
		if (resolved && existsSync(resolved)) return resolved;
	} catch { /* not found */ }
	return "pi";
}

export const PI_BINARY = resolvePiBinary();

// ── Utilities ───────────────────────────────────────────────────

export const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// ── Event formatting ────────────────────────────────────────────

type Evt = Record<string, unknown>;

const EVENT_FORMATTERS: Record<string, (e: Evt) => string> = {
	message_update: (e) => {
		const d = e.assistantMessageEvent as Evt | undefined;
		return d?.type === "text_delta" ? String(d.delta) : "";
	},
	tool_execution_start: (e) =>
		`\n⚙ ${e.toolName}(${JSON.stringify(e.args ?? {}).slice(0, 80)})`,
	tool_execution_end: (e) => {
		const text = (e.result as Evt | undefined)?.content;
		const first = Array.isArray(text) ? (text[0] as Evt | undefined)?.text : undefined;
		return `  → ${String(first ?? "(done)").slice(0, 100)}`;
	},
	agent_start: () => "\n▶ agent started",
	agent_end: () => "\n■ agent finished",
	response: (e) => `  [${e.command}: ${e.success ? "ok" : e.error}]`,
};

/** Format a single JSONL event line into a compact human-readable string. */
export function formatEvent(line: string): string {
	try {
		const evt = JSON.parse(line) as Evt;
		const fmt = EVENT_FORMATTERS[String(evt.type ?? "?")];
		return fmt ? fmt(evt) : `  [${evt.type ?? "?"}]`;
	} catch {
		return line.slice(0, 120);
	}
}

/** Format the last `lines` events from an array into readable output. */
export function recentOutputFromEvents(events: string[], lines = 20): string {
	if (events.length === 0) return "(no events yet)";
	return events
		.slice(-lines)
		.map(formatEvent)
		.filter(Boolean)
		.join("");
}

// ── Spawn arg building ──────────────────────────────────────────

interface ArgParams {
	model?: string;
	tools?: string[];
	sessionDir?: string;
	name: string;
}

/** Default session directory for subagents. */
function defaultSubagentSessionDir(name: string): string {
	return join(homedir(), ".pi", "agent", "sessions", "subagents", name);
}

/**
 * Build the CLI arg list for spawning a pi agent (pure — no side effects).
 * System-prompt file creation is handled separately in spawn_agent.
 */
export function buildArgList(p: ArgParams): string[] {
	const args = ["--mode", "rpc"];
	if (p.model) args.push("--models", p.model);
	if (p.tools?.length) args.push("--tools", p.tools.join(","));
	const sessionDir = p.sessionDir ?? defaultSubagentSessionDir(p.name);
	args.push("--session-dir", sessionDir);
	return args;
}

// ── Types ───────────────────────────────────────────────────────

export interface SpawnedAgent {
	name: string;
	proc: ChildProcess;
	pid: number;
	cwd: string;
	model?: string;
	startedAt: number;
	recentEvents: string[];
	emitter: EventEmitter;
	tempDir?: string;
	done: boolean;
}

export const MAX_RECENT_EVENTS = 100;

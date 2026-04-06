/**
 * Kanban board.log watcher — fast-path widget + slow-path LLM injection.
 *
 * Watches board.log for changes and:
 * 1. Fast path (every change): updates TUI widget with WIP/status summary
 * 2. Slow path (COMPLETE/BLOCKED + idle + cooldown): injects a followUp
 *    message to trigger the orchestrator to run kanban_monitor
 *
 * Safeguards against injection loops:
 * - Only inject when ctx.isIdle()
 * - 5-minute cooldown between injections
 * - Max 3 consecutive auto-injections without human input
 * - Counter resets on agent_end (human engaged)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { watch, readFileSync, type FSWatcher } from "node:fs";
import {
	parseBoard,
	boardLogPath,
	selfAppendedLines,
	type BoardState,
	WIP_LIMIT,
} from "./board.js";

// ── Constants ───────────────────────────────────────────────

const DEBOUNCE_MS = 200;
const INJECT_COOLDOWN_MS = 5 * 60_000;
const MAX_CONSECUTIVE_INJECTS = 3;

const INJECT_MESSAGE = [
	"Board updated externally (kanban watcher detected new events).",
	"Run kanban_snapshot to see current state.",
	"Run kanban_monitor and agent_status to check agent health.",
	"If any agents are STALLED, nudge them.",
	"If any tasks show DONE (REPORT.md found), call kanban_complete.",
	"Do not ask me any questions. Keep your response brief.",
].join(" ");

// ── Types ───────────────────────────────────────────────────

interface WatcherState {
	watcher: FSWatcher | null;
	debounceTimer: ReturnType<typeof setTimeout> | null;
	lastAutoInjectTime: number;
	consecutiveAutoInjects: number;
	lastWidgetHash: string;
	lastEventCount: number;
}

// ── Detect new events by tailing the log ────────────────────

function detectNewEvents(lastCount: number): string[] {
	if (lastCount <= 0) return [];
	try {
		const raw = readFileSync(boardLogPath(), "utf-8");
		const lines = raw.split("\n").filter((l) => l.trim());
		return lines.slice(lastCount);
	} catch {
		return [];
	}
}

function hasExternalEvents(newLines: string[]): boolean {
	return newLines.some((line) => {
		const trimmed = line.trim();
		if (!trimmed) return false;
		if (selfAppendedLines.has(trimmed)) {
			selfAppendedLines.delete(trimmed); // clean up
			return false;
		}
		return true;
	});
}

// ── Widget rendering (fast path, no LLM) ────────────────────

function buildWidgetLines(board: BoardState): string[] {
	const buckets: Record<string, number> = {};
	const inProgress: string[] = [];

	for (const tid of board.order) {
		const t = board.tasks.get(tid);
		if (!t || t.deleted) continue;
		buckets[t.col] = (buckets[t.col] ?? 0) + 1;
		if (t.col === "in-progress") {
			inProgress.push(`  ${t.id} ${t.title.slice(0, 30)} (${t.claimAgent || "?"})`);
		}
	}

	const wip = buckets["in-progress"] ?? 0;
	const blocked = buckets.blocked ?? 0;
	const done = buckets.done ?? 0;
	const todo = buckets.todo ?? 0;

	const lines = [
		`📋 WIP ${wip}/${WIP_LIMIT} | todo ${todo} | blocked ${blocked} | done ${done}`,
		...inProgress,
	];
	return lines;
}

function buildStatusText(board: BoardState): string {
	let wip = 0;
	let blocked = 0;
	for (const t of board.tasks.values()) {
		if (t.deleted) continue;
		if (t.col === "in-progress") wip++;
		if (t.col === "blocked") blocked++;
	}
	const parts = [`WIP ${wip}/${WIP_LIMIT}`];
	if (blocked > 0) parts.push(`${blocked} blocked`);
	return `📋 ${parts.join(" | ")}`;
}

// ── Setup ───────────────────────────────────────────────────

export function setupWatcher(pi: ExtensionAPI): void {
	const state: WatcherState = {
		watcher: null,
		debounceTimer: null,
		lastAutoInjectTime: 0,
		consecutiveAutoInjects: 0,
		lastWidgetHash: "",
		lastEventCount: 0,
	};

	let ctx: ExtensionContext | null = null;

	// ── Fast path: update widget from board state ───────────

	async function updateWidget(): Promise<void> {
		if (!ctx) return;
		try {
			const board = await parseBoard();

			// Widget
			const lines = buildWidgetLines(board);
			const hash = lines.join("\n");
			if (hash !== state.lastWidgetHash) {
				state.lastWidgetHash = hash;
				ctx.ui.setWidget("kanban", lines);
			}

			// Status bar
			ctx.ui.setStatus("kanban", buildStatusText(board));

			// Slow path: check for actionable events
			const newLines = detectNewEvents(state.lastEventCount);
			state.lastEventCount = board.totalEvents;

			if (hasExternalEvents(newLines)) {
				maybeInject();
			}
		} catch {
			/* board.log may not exist yet */
		}
	}

	// ── Slow path: inject LLM followUp (gated) ─────────────

	function maybeInject(): void {
		if (!ctx) return;

		// Gate: agent must be idle
		if (!ctx.isIdle()) return;

		// Gate: cooldown
		const now = Date.now();
		if (now - state.lastAutoInjectTime < INJECT_COOLDOWN_MS) return;

		// Gate: max consecutive without human input
		if (state.consecutiveAutoInjects >= MAX_CONSECUTIVE_INJECTS) {
			ctx.ui.setStatus("kanban", "⏸ Auto-monitor paused — type anything to resume");
			return;
		}

		state.lastAutoInjectTime = now;
		state.consecutiveAutoInjects++;

		pi.sendUserMessage(INJECT_MESSAGE, { deliverAs: "followUp" });
	}

	// ── Debounced file change handler ───────────────────────

	function onFileChange(): void {
		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		state.debounceTimer = setTimeout(() => {
			updateWidget().catch(() => { /* non-fatal */ });
		}, DEBOUNCE_MS);
	}

	// ── Start/stop watcher ──────────────────────────────────

	function startWatcher(): void {
		stopWatcher();
		try {
			const logPath = boardLogPath();
			state.watcher = watch(logPath, onFileChange);
			state.watcher.unref();
			// Initial read
			updateWidget().catch(() => { /* non-fatal */ });
		} catch {
			/* board.log path may not resolve — watcher will not start */
		}
	}

	function stopWatcher(): void {
		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		state.debounceTimer = null;
		if (state.watcher) {
			state.watcher.close();
			state.watcher = null;
		}
	}

	// ── Lifecycle hooks ─────────────────────────────────────

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		state.lastAutoInjectTime = 0;
		state.consecutiveAutoInjects = 0;
		state.lastWidgetHash = "";
		state.lastEventCount = 0;
		startWatcher();
	});

	pi.on("session_shutdown", async () => {
		stopWatcher();
		ctx = null;
	});

	pi.on("agent_end", async () => {
		// Human (or LLM) finished a turn — reset injection counter
		state.consecutiveAutoInjects = 0;
		// Refresh widget
		updateWidget().catch(() => { /* non-fatal */ });
	});

	// ── Commands ────────────────────────────────────────────

	pi.registerCommand("monitor-reset", {
		description: "Reset auto-monitor injection counter (resume after pause)",
		handler: async (_args, c) => {
			state.consecutiveAutoInjects = 0;
			state.lastAutoInjectTime = 0;
			c.ui.notify("Auto-monitor reset — will inject on next actionable event", "info");
		},
	});

	pi.registerCommand("monitor-pause", {
		description: "Pause autonomous monitoring injections (widget updates continue)",
		handler: async (_args, c) => {
			state.consecutiveAutoInjects = MAX_CONSECUTIVE_INJECTS;
			c.ui.notify("Auto-monitor paused. Use /monitor-reset to resume.", "info");
		},
	});
}

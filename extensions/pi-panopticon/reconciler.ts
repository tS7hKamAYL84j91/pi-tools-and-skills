/**
 * Proactive review/reconciliation loop.
 *
 * Periodically inspects durable operational state and agent registry
 * to detect conditions that need attention without waiting for a new
 * human message. Outputs route through pi.sendUserMessage as followUp
 * injections.
 *
 * Heuristics:
 *   1. Stale blocked tasks (in-progress but agent is STALLED/MISSING)
 *   2. Silent-done workers (agent terminated but task still in-progress)
 *   3. Overdue workspace activity (no input for extended period after resume)
 *   4. Session resumed from a previous file (reminder to check prior context)
 *
 * Idempotency / cooldown:
 *   - Each heuristic has its own cooldown timer
 *   - Max consecutive injections without human input (resets on agent_end)
 *   - Only fires when ctx.isIdle()
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { OperationalStateStore } from "./state.js";
import type { Registry } from "./types.js";
import { findAgentByName } from "../../lib/agent-api.js";
import { parseCompletionSignal, type CompletionSignal } from "../../lib/completion-signal.js";

// ── Constants ───────────────────────────────────────────────────

const RECONCILE_INTERVAL_MS = 60_000;
const HEURISTIC_COOLDOWN_MS = 10 * 60_000;
const MAX_CONSECUTIVE_INJECTS = 2;
const STALE_ACTIVITY_MS = 30 * 60_000;

// ── Types ───────────────────────────────────────────────────────

interface Finding {
	heuristic: string;
	summary: string;
}

interface ReconcilerModule {
	start(ctx: ExtensionContext): void;
	stop(): void;
	onAgentEnd(): void;
	/** Process an inbound agent message for structured completion signals. */
	handleInboundMessage(text: string): CompletionSignal | undefined;
}

// ── Heuristic: stale/silent workers ─────────────────────────────

function checkAgentHealth(registry: Registry, selfId: string): Finding[] {
	const findings: Finding[] = [];
	const peers = registry.readAllPeers();
	for (const peer of peers) {
		if (peer.id === selfId) continue;
		const info = findAgentByName(peer.name);
		if (!info) continue;
		if (!info.alive && peer.status !== "terminated") {
			findings.push({
				heuristic: "silent-done",
				summary: `Agent "${peer.name}" (pid ${peer.pid}) appears terminated but registry still shows status="${peer.status}".`,
			});
		} else if (info.alive && info.heartbeatAge > 300_000) {
			findings.push({
				heuristic: "stale-worker",
				summary: `Agent "${peer.name}" heartbeat is ${Math.round(info.heartbeatAge / 60_000)}m stale — may be stuck.`,
			});
		}
	}
	return findings;
}

// ── Heuristic: stale workspace activity ─────────────────────────

function checkStaleActivity(stateStore: OperationalStateStore): Finding[] {
	const state = stateStore.getState();
	if (!state) return [];
	const age = Date.now() - state.lastActiveAt;
	if (age > STALE_ACTIVITY_MS) {
		return [{
			heuristic: "stale-activity",
			summary: `No workspace activity for ${Math.round(age / 60_000)}m. Last active channel: ${state.sourceChannel}/${state.humanIdentity}.`,
		}];
	}
	return [];
}

// ── Heuristic: resumed session reminder ─────────────────────────

function checkResumeReminder(stateStore: OperationalStateStore, alreadyFired: Set<string>): Finding[] {
	const state = stateStore.getState();
	if (!state) return [];
	if (state.resume.reason !== "resume" || !state.resume.previousSessionFile) return [];
	const key = `resume:${state.resume.previousSessionFile}`;
	if (alreadyFired.has(key)) return [];
	alreadyFired.add(key);
	return [{
		heuristic: "resume-reminder",
		summary: `Session resumed from ${state.resume.previousSessionFile}. Consider reviewing prior context.`,
	}];
}

// ── Setup ───────────────────────────────────────────────────────

export function setupReconciler(
	pi: ExtensionAPI,
	registry: Registry,
	selfId: string,
	stateStore: OperationalStateStore,
): ReconcilerModule {
	let timer: ReturnType<typeof setInterval> | null = null;
	let ctx: ExtensionContext | null = null;
	let consecutiveInjects = 0;
	const lastFiredAt = new Map<string, number>();
	const resumeReminders = new Set<string>();

	function isOnCooldown(heuristic: string): boolean {
		const last = lastFiredAt.get(heuristic) ?? 0;
		return Date.now() - last < HEURISTIC_COOLDOWN_MS;
	}

	function reconcile(): void {
		if (!ctx) return;
		if (!ctx.isIdle()) return;
		if (consecutiveInjects >= MAX_CONSECUTIVE_INJECTS) return;

		const allFindings: Finding[] = [];

		// Run heuristics, skip those on cooldown
		const agentFindings = checkAgentHealth(registry, selfId);
		for (const f of agentFindings) {
			if (!isOnCooldown(f.heuristic)) allFindings.push(f);
		}

		const activityFindings = checkStaleActivity(stateStore);
		for (const f of activityFindings) {
			if (!isOnCooldown(f.heuristic)) allFindings.push(f);
		}

		const resumeFindings = checkResumeReminder(stateStore, resumeReminders);
		allFindings.push(...resumeFindings);

		if (allFindings.length === 0) return;

		// Mark cooldowns
		for (const f of allFindings) {
			lastFiredAt.set(f.heuristic, Date.now());
		}

		consecutiveInjects++;

		const message = [
			"🔍 Reconciliation check detected:",
			...allFindings.map((f) => `  • [${f.heuristic}] ${f.summary}`),
			"",
			"Review and take action if needed. Run kanban_snapshot and agent_status for current state.",
			"Do not ask questions. Keep your response brief.",
		].join("\n");

		pi.sendUserMessage(message, { deliverAs: "followUp" });
	}

	return {
		handleInboundMessage(text: string): CompletionSignal | undefined {
			return parseCompletionSignal(text);
		},

		start(c: ExtensionContext): void {
			ctx = c;
			consecutiveInjects = 0;
			lastFiredAt.clear();
			resumeReminders.clear();

			// Delay first reconcile to let session stabilize
			timer = setInterval(reconcile, RECONCILE_INTERVAL_MS);
		},

		stop(): void {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			ctx = null;
		},

		onAgentEnd(): void {
			consecutiveInjects = 0;
		},
	};
}

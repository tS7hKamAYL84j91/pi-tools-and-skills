/**
 * Proactive review/reconciliation loop.
 *
 * Periodically inspects durable operational state and agent registry
 * to detect conditions that need attention without waiting for a new
 * human message. Outputs route through pi.sendUserMessage as followUp
 * injections.
 *
 * Heuristics:
 *   1. Actionable peer state (pending messages, blocked agents)
 *   2. Confirmed stale workers and silent termination before DONE
 *   3. Overdue workspace activity only when peers are not operationally quiet
 *   4. Session resumed from a previous file (reminder to check prior context)
 *
 * Idempotency / cooldown:
 *   - Each heuristic has its own cooldown timer
 *   - Max consecutive injections without human input (resets on agent_end)
 *   - Only fires when ctx.isIdle()
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OperationalStateStore } from "./state.js";
import type { Registry } from "./types.js";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { findAgentByName } from "../../lib/agent-api.js";
import { parseCompletionSignal, type CompletionSignal } from "../../lib/completion-signal.js";

// ── Constants ───────────────────────────────────────────────────

const RECONCILE_INTERVAL_MS = 60_000;
const HEURISTIC_COOLDOWN_MS = 10 * 60_000;
const MAX_CONSECUTIVE_INJECTS = 2;
const STALE_ACTIVITY_MS = 30 * 60_000;
const FRESH_HEARTBEAT_MS = 60_000;
const STALE_WORKER_MS = 5 * 60_000;

// ── Types ───────────────────────────────────────────────────────

type FindingLevel = "actionable" | "informational";

interface Finding {
	heuristic: string;
	summary: string;
	level: FindingLevel;
}

type RegistryPeer = AgentRecord;

interface ConfirmedPeerState {
	id: string;
	name: string;
	pid: number;
	alive: boolean;
	heartbeatAge: number;
	status: string;
	pendingMessages: number;
	confirmed: boolean;
}

interface ReconcilerModule {
	start(ctx: ExtensionContext): void;
	stop(): void;
	onAgentEnd(): void;
	/** Process an inbound agent message for structured completion signals. */
	handleInboundMessage(text: string): CompletionSignal | undefined;
}

// ── Heuristic: stale/silent workers ─────────────────────────────

function confirmedPeerState(peer: RegistryPeer): ConfirmedPeerState {
	const info = findAgentByName(peer.name);
	if (info?.id === peer.id) {
		return {
			id: info.id,
			name: info.name,
			pid: info.pid,
			alive: info.alive,
			heartbeatAge: info.heartbeatAge,
			status: info.status,
			pendingMessages: peer.pendingMessages ?? 0,
			confirmed: true,
		};
	}

	return {
		id: peer.id,
		name: peer.name,
		pid: peer.pid,
		alive: peer.status !== "terminated",
		heartbeatAge: Date.now() - peer.heartbeat,
		status: peer.status,
		pendingMessages: peer.pendingMessages ?? 0,
		confirmed: false,
	};
}

function actionableAgentFindings(peer: RegistryPeer, confirmed: ConfirmedPeerState): Finding[] {
	const findings: Finding[] = [];
	if (confirmed.pendingMessages > 0) {
		findings.push({
			heuristic: "pending-messages",
			summary: `Agent "${confirmed.name}" has ${confirmed.pendingMessages} pending message(s).`,
			level: "actionable",
		});
	}

	if (peer.status === "blocked" || confirmed.status === "blocked") {
		findings.push({
			heuristic: "blocked-agent",
			summary: `Agent "${confirmed.name}" self-reports blocked status.`,
			level: "actionable",
		});
	}

	if (confirmed.confirmed && !confirmed.alive && peer.status !== "terminated" && peer.status !== "done") {
		findings.push({
			heuristic: "silent-done",
			summary: `Agent "${confirmed.name}" (pid ${confirmed.pid}) appears terminated but registry still shows status="${peer.status}".`,
			level: "actionable",
		});
	}

	if (confirmed.confirmed && confirmed.alive && (confirmed.status === "stalled" || confirmed.heartbeatAge > STALE_WORKER_MS)) {
		findings.push({
			heuristic: "stale-worker",
			summary: `Agent "${confirmed.name}" is stalled after confirmation; heartbeat age is ${Math.round(confirmed.heartbeatAge / 60_000)}m.`,
			level: "actionable",
		});
	}

	return findings;
}

function isOperationallyQuiet(peer: RegistryPeer, confirmed: ConfirmedPeerState): boolean {
	if (confirmed.pendingMessages > 0) return false;
	if (peer.status === "blocked" || confirmed.status === "blocked") return false;
	if (!confirmed.confirmed) return true;
	if (!confirmed.alive) return peer.status === "done" || peer.status === "terminated";
	if (confirmed.heartbeatAge > FRESH_HEARTBEAT_MS) return false;
	return confirmed.status === "waiting" || confirmed.status === "running" || confirmed.status === "done";
}

export function checkAgentHealth(registry: Registry, selfId: string): Finding[] {
	const findings: Finding[] = [];
	const peers = registry.readAllPeers();
	for (const peer of peers) {
		if (peer.id === selfId) continue;
		findings.push(...actionableAgentFindings(peer, confirmedPeerState(peer)));
	}
	return findings;
}

// ── Heuristic: stale workspace activity ─────────────────────────

export function checkStaleActivity(
	stateStore: OperationalStateStore,
	registry: Registry,
	selfId: string,
): Finding[] {
	const state = stateStore.getState();
	if (!state) return [];
	const age = Date.now() - state.lastActiveAt;
	if (age <= STALE_ACTIVITY_MS) return [];

	const peers = registry.readAllPeers().filter((peer) => peer.id !== selfId);
	const allPeersQuiet = peers.every((peer) => isOperationallyQuiet(peer, confirmedPeerState(peer)));
	if (allPeersQuiet) return [];

	return [{
		heuristic: "stale-activity",
		summary: `No workspace activity for ${Math.round(age / 60_000)}m. Last active channel: ${state.sourceChannel}/${state.humanIdentity}.`,
		level: "informational",
	}];
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
		level: "informational",
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

		const activityFindings = checkStaleActivity(stateStore, registry, selfId);
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
			"Review and take action if needed. Run agent_status for current agent state.",
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

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

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type CompletionSignal,
	parseCompletionSignal,
} from "../../../lib/completion-signal.js";
import type { Registry } from "../types.js";
import { registerReconcilerControls } from "./reconciler-control.js";
import {
	checkAgentHealth,
	checkStaleActivity,
	type ReconciliationFinding,
} from "./reconciler-findings.js";
import {
	type ReconcilerSettingsScope,
	resolveReconcilerSettings,
	saveReconcilerSetting,
} from "./reconciler-settings.js";
import type { OperationalStateStore } from "./state.js";

// ── Constants ───────────────────────────────────────────────────

const RECONCILE_INTERVAL_MS = 60_000;
const HEURISTIC_COOLDOWN_MS = 10 * 60_000;
const MAX_CONSECUTIVE_INJECTS = 2;

// ── Types ───────────────────────────────────────────────────────

interface ReconcilerModule {
	start(ctx: ExtensionContext): void;
	stop(): void;
	onAgentEnd(): void;
	setEnabled(enabled: boolean): Promise<void>;
	getStatus(): string;
	isEnabled(): boolean;
	/** Process an inbound agent message for structured completion signals. */
	handleInboundMessage(text: string): CompletionSignal | undefined;
}

// ── Heuristic: resumed session reminder ─────────────────────────

function checkResumeReminder(
	stateStore: OperationalStateStore,
	alreadyFired: Set<string>,
): ReconciliationFinding[] {
	const state = stateStore.getState();
	if (!state) return [];
	if (state.resume.reason !== "resume" || !state.resume.previousSessionFile)
		return [];
	const key = `resume:${state.resume.previousSessionFile}`;
	if (alreadyFired.has(key)) return [];
	alreadyFired.add(key);
	return [
		{
			heuristic: "resume-reminder",
			summary: `Session resumed from ${state.resume.previousSessionFile}. Consider reviewing prior context.`,
			level: "informational",
		},
	];
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
	let settingsScope: ReconcilerSettingsScope = "global";
	let notificationsEnabled = false;
	let consecutiveInjects = 0;
	const lastFiredAt = new Map<string, number>();
	const resumeReminders = new Set<string>();

	function isOnCooldown(heuristic: string): boolean {
		const last = lastFiredAt.get(heuristic) ?? 0;
		return Date.now() - last < HEURISTIC_COOLDOWN_MS;
	}

	function reconcile(): void {
		if (!ctx || !notificationsEnabled) return;
		if (!ctx.isIdle()) return;
		if (consecutiveInjects >= MAX_CONSECUTIVE_INJECTS) return;

		const allFindings: ReconciliationFinding[] = [];

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

	registerReconcilerControls(pi, {
		setEnabled: async (enabled) => {
			notificationsEnabled = enabled;
			if (ctx) {
				await saveReconcilerSetting(settingsScope, enabled, ctx.cwd);
			}
		},
		getStatus: () => (notificationsEnabled ? "on" : "off"),
	});

	return {
		handleInboundMessage(text: string): CompletionSignal | undefined {
			return parseCompletionSignal(text);
		},

		start(c: ExtensionContext): void {
			ctx = c;
			const trusted =
				"isProjectTrusted" in c && typeof c.isProjectTrusted === "function"
					? c.isProjectTrusted()
					: false;
			settingsScope = trusted ? "project" : "global";
			notificationsEnabled = resolveReconcilerSettings(
				c.cwd,
				trusted,
			).reconciliationNotifications;
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

		async setEnabled(enabled: boolean): Promise<void> {
			notificationsEnabled = enabled;
			if (ctx) {
				await saveReconcilerSetting(settingsScope, enabled, ctx.cwd);
			}
		},

		getStatus(): string {
			return notificationsEnabled ? "on" : "off";
		},

		isEnabled(): boolean {
			return notificationsEnabled;
		},
	};
}

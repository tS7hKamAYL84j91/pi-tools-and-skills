/**
 * Agent Health Assessment Module
 *
 * Provides structured agent health monitoring with sleep-aware stall
 * detection, extended status taxonomy, and nudge delivery.
 *
 * Implements:
 * - T-135: agent_status tool (structured health API)
 * - T-136: Sleep-aware stall detection
 * - T-137: Extended status taxonomy (active/stalled/sleeping/terminated/api_error/blocked/waiting)
 * - T-138: agent_nudge tool (socket + maildir delivery)
 *
 * The health assessment is stateful — stall tracking uses an in-memory
 * Map that accumulates across calls. Call agent_status periodically
 * (e.g. from kanban_monitor) for stall detection to work.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as net from "node:net";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { REGISTRY_DIR, isPidAlive } from "../../lib/agent-registry.js";
import { readSessionLog } from "../../lib/session-log.js";
import { createMaildirTransport } from "../../lib/transports/maildir.js";
import type { Registry } from "./types.js";
import { ok } from "./types.js";
import { getSelfName, resolvePeer, peerNames } from "./peers.js";

// ── Types ───────────────────────────────────────────────────────

/**
 * Extended health status taxonomy.
 *
 * Goes beyond the registry's self-reported AgentStatus by assessing
 * liveness, activity patterns, and error state.
 */
/** @public */
export type AgentHealthStatus =
	| "active"      // PID alive, activity is changing
	| "stalled"     // PID alive, heartbeat stale, activity unchanged ≥ threshold
	| "sleeping"    // PID alive, heartbeat fresh, activity unchanged (system sleep or thinking)
	| "terminated"  // PID dead
	| "api_error"   // recent activity shows repeated errors
	| "blocked"     // agent self-reported blocked
	| "waiting"     // agent idle between tasks
	| "unknown";    // insufficient data

/**
 * Structured agent health — the return type of agent_status.
 * Designed so kanban_monitor (and other consumers) can use this
 * directly instead of scanning the registry themselves.
 */
/** @public */
export interface AgentHealth {
	name: string;
	pid: number;
	alive: boolean;
	status: AgentHealthStatus;
	heartbeatAge: number;       // ms since last heartbeat
	stallCycles: number;        // consecutive unchanged activity hashes
	model: string;
	pendingMessages: number;
	socket: string;             // path for nudging
}

// ── Constants ───────────────────────────────────────────────────

const DEFAULT_STALL_THRESHOLD = 3;
const HEARTBEAT_STALE_MS = 60_000;
const ACTIVITY_WINDOW = 20;     // session events to hash
const ERROR_WINDOW = 5;         // recent events to check for errors

// ── Stall tracking (in-memory, per assessor lifetime) ───────────

interface StallState {
	lastHash: string;
	stallCount: number;
}

// ── Pure helpers (exported for tests) ───────────────────────────

/**
 * Hash recent session activity for change detection.
 * Returns "" if no session file or no events.
 */
export function computeActivityHash(sessionFile: string | undefined): string {
	if (!sessionFile) return "";
	const events = readSessionLog(sessionFile, ACTIVITY_WINDOW);
	if (events.length === 0) return "";
	return createHash("md5").update(JSON.stringify(events)).digest("hex");
}

/**
 * Check if recent activity shows repeated errors (e.g. API failures).
 * Returns true if a majority of recent tool_result events are errors.
 */
export function detectApiErrors(sessionFile: string | undefined): boolean {
	if (!sessionFile) return false;
	const events = readSessionLog(sessionFile, ERROR_WINDOW);
	const toolResults = events.filter((e) => e.event === "tool_result");
	if (toolResults.length === 0) return false;
	const errors = toolResults.filter((e) => e.isError === true);
	// Majority of recent tool results are errors
	return errors.length > 0 && errors.length >= Math.ceil(toolResults.length / 2);
}

/**
 * Compute the socket path for an agent.
 * Convention: ~/.pi/agents/{id}.sock
 */
export function agentSocketPath(agentId: string): string {
	return join(REGISTRY_DIR, `${agentId}.sock`);
}

/**
 * Assess the health status of a single agent.
 * Requires the stall tracker map for stall cycle counting.
 *
 * @param record       The agent's registry record
 * @param stallTracker Mutable map tracking per-agent stall state
 * @param threshold    Number of unchanged cycles before declaring stalled
 * @returns            Structured health assessment
 */
export function assessHealth(
	record: AgentRecord,
	stallTracker: Map<string, StallState>,
	threshold: number = DEFAULT_STALL_THRESHOLD,
): AgentHealth {
	const now = Date.now();
	const alive = isPidAlive(record.pid);
	const heartbeatAge = now - record.heartbeat;
	const sock = agentSocketPath(record.id);

	const health: AgentHealth = {
		name: record.name,
		pid: record.pid,
		alive,
		status: "unknown",
		heartbeatAge,
		stallCycles: 0,
		model: record.model,
		pendingMessages: record.pendingMessages ?? 0,
		socket: sock,
	};

	// ── Terminated: PID is dead ────────────────────────────────
	if (!alive) {
		health.status = "terminated";
		stallTracker.delete(record.id);
		return health;
	}

	// ── Self-reported blocked ──────────────────────────────────
	if (record.status === "blocked") {
		health.status = "blocked";
		return health;
	}

	// ── Self-reported waiting (idle between tasks) ─────────────
	if (record.status === "waiting") {
		health.status = "waiting";
		// Reset stall counter when agent is idle
		stallTracker.delete(record.id);
		return health;
	}

	// ── API error detection ────────────────────────────────────
	if (detectApiErrors(record.sessionFile)) {
		health.status = "api_error";
		return health;
	}

	// ── Activity hash stall detection (sleep-aware) ────────────
	const hash = computeActivityHash(record.sessionFile);
	const prev = stallTracker.get(record.id);

	if (prev && hash === prev.lastHash && hash !== "") {
		// Activity unchanged — increment stall counter
		const cycles = prev.stallCount + 1;
		stallTracker.set(record.id, { lastHash: hash, stallCount: cycles });
		health.stallCycles = cycles;

		if (cycles >= threshold) {
			// T-136: Sleep-aware — only declare stalled if heartbeat is ALSO stale.
			// If heartbeat is fresh but activity unchanged, the agent is likely
			// sleeping (Mac sleep/wake) or thinking (long computation).
			if (heartbeatAge > HEARTBEAT_STALE_MS) {
				health.status = "stalled";
			} else {
				health.status = "sleeping";
			}
		} else {
			// Below threshold — still considered active (building up stall count)
			health.status = "active";
		}
	} else {
		// Activity changed — reset stall counter
		stallTracker.set(record.id, { lastHash: hash, stallCount: 0 });
		health.status = "active";
	}

	return health;
}

/**
 * Send an immediate nudge via Unix socket.
 * Best-effort, non-blocking with 3s timeout.
 * Returns true if the message was delivered.
 */
/** @public */
export async function socketNudge(
	sockPath: string,
	from: string,
	text: string,
): Promise<boolean> {
	try {
		if (!existsSync(sockPath)) return false;
		await new Promise<void>((resolve, reject) => {
			const client = net.createConnection({ path: sockPath }, () => {
				client.end(`${JSON.stringify({ type: "cast", from, text })}\n`);
			});
			client.on("end", () => resolve());
			client.on("error", (e: Error) => reject(e));
			client.setTimeout(3_000);
			client.on("timeout", () => {
				client.destroy();
				reject(new Error("timeout"));
			});
		});
		return true;
	} catch {
		return false;
	}
}

// ── Formatting ──────────────────────────────────────────────────

const STATUS_ICON: Record<AgentHealthStatus, string> = {
	active: "🟢",
	stalled: "🛑",
	sleeping: "😴",
	terminated: "💀",
	api_error: "⚠️",
	blocked: "🚧",
	waiting: "🟡",
	unknown: "⚪",
};

function formatAge(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
	return `${Math.round(ms / 60_000)}m`;
}

function formatHealthTable(healths: AgentHealth[]): string {
	const lines = healths.map((h) => {
		const icon = STATUS_ICON[h.status];
		const parts = [
			`${icon} ${h.name.padEnd(20)}`,
			h.status.padEnd(12),
			`pid=${h.pid}`,
			`alive=${h.alive}`,
			`heartbeat=${formatAge(h.heartbeatAge)}`,
			`stalls=${h.stallCycles}`,
			`model=${h.model || "?"}`,
			`msgs=${h.pendingMessages}`,
		];
		return `  ${parts.join(" ")}`;
	});
	return `Agent health (${healths.length}):\n${lines.join("\n")}`;
}

// ── Module setup ────────────────────────────────────────────────

/** @public */
export interface HealthModule {
	/** Assess health of a single agent by record. */
	assess(record: AgentRecord, threshold?: number): AgentHealth;
	/** Assess all peer agents. */
	assessAll(threshold?: number): AgentHealth[];
}

export function setupHealth(
	pi: ExtensionAPI,
	registry: Registry,
): HealthModule {
	const stallTracker = new Map<string, StallState>();
	const transport = createMaildirTransport();



	// ── T-135: agent_status tool ───────────────────────────────

	pi.registerTool({
		name: "agent_status",
		label: "Agent Status",
		description:
			"Get structured health status for one or all peer agents. " +
			"Returns: alive, status (active/stalled/sleeping/terminated/api_error/blocked/waiting), " +
			"heartbeat age, stall cycles, pending messages, and socket path. " +
			"Call periodically for stall detection to accumulate cycles.",
		promptSnippet: "Check agent health with structured status assessment",
		promptGuidelines: [
			"Call agent_status periodically (like kanban_monitor does) for stall detection to work — each call updates the stall cycle counter.",
			"Status meanings: active (working), stalled (PID alive but stuck), sleeping (PID alive, heartbeat fresh, no activity — likely system sleep), terminated (PID dead), api_error (recent errors), blocked (self-reported), waiting (idle).",
			"Use agent_nudge to poke stalled or blocked agents.",
		],
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Agent name to check. Omit for all peer agents." }),
			),
			stall_threshold: Type.Optional(
				Type.Number({
					description: "Consecutive unchanged cycles before declaring stalled (default: 3)",
					default: DEFAULT_STALL_THRESHOLD,
				}),
			),
		}),

		async execute(_id, params, _signal) {
			const threshold = params.stall_threshold ?? DEFAULT_STALL_THRESHOLD;

			if (params.name) {
				const rec = resolvePeer(registry, params.name);
				if (!rec) {
					return ok(`No agent named "${params.name}". Known peers: ${peerNames(registry)}`);
				}
				const h = assessHealth(rec, stallTracker, threshold);
				return ok(formatHealthTable([h]), { agents: [h] });
			}

			const self = registry.getRecord();
			const peers = registry.readAllPeers().filter((r) => !self || r.id !== self.id);

			if (peers.length === 0) {
				return ok("No peer agents registered.", { agents: [] });
			}

			const healths = peers.map((r) => assessHealth(r, stallTracker, threshold));
			return ok(formatHealthTable(healths), { agents: healths });
		},
	});

	// ── T-138: agent_nudge tool ────────────────────────────────

	pi.registerTool({
		name: "agent_nudge",
		label: "Agent Nudge",
		description:
			"Send an urgent nudge to a named agent. " +
			"Delivers via durable Maildir AND tries immediate socket notification. " +
			"Use for stalled or blocked agents that need a poke.",
		promptSnippet: "Send an urgent nudge to a stalled or blocked agent",
		promptGuidelines: [
			"Use agent_nudge when agent_status reports stalled or blocked agents.",
			"Prefer agent_send for normal communication — agent_nudge is for urgent pokes.",
			"The nudge is delivered via Maildir (durable) plus socket (immediate) if available.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Agent name to nudge" }),
			message: Type.String({ description: "Nudge message text" }),
		}),

		async execute(_id, params, _signal) {
			const peer = resolvePeer(registry, params.name);
			if (!peer) {
				return ok(`No agent named "${params.name}". Known peers: ${peerNames(registry)}`);
			}

			const from = getSelfName(registry);

			// Durable delivery via Maildir
			const mailResult = await transport.send(peer, from, params.message);

			// Immediate socket poke (best-effort)
			const sock = agentSocketPath(peer.id);
			const socketOk = await socketNudge(sock, from, params.message);

			const details = {
				name: peer.name,
				maildir: mailResult.accepted,
				socket: socketOk,
				maildirRef: mailResult.reference,
			};

			if (mailResult.accepted && socketOk) {
				return ok(`Nudged ${peer.name}: delivered via maildir + socket`, details);
			}
			if (mailResult.accepted) {
				return ok(`Nudged ${peer.name}: delivered via maildir (no socket)`, details);
			}
			if (socketOk) {
				return ok(`Nudged ${peer.name}: delivered via socket only (maildir failed: ${mailResult.error})`, details);
			}
			return ok(`Failed to nudge ${peer.name}: maildir=${mailResult.error}, socket=unavailable`, details);
		},
	});

	// ── Module handle ──────────────────────────────────────────

	const module: HealthModule = {
		assess(record, threshold = DEFAULT_STALL_THRESHOLD) {
			return assessHealth(record, stallTracker, threshold);
		},
		assessAll(threshold = DEFAULT_STALL_THRESHOLD) {
			const self = registry.getRecord();
			return registry.readAllPeers()
				.filter((r) => !self || r.id !== self.id)
				.map((r) => assessHealth(r, stallTracker, threshold));
		},
	};

	return module;
}

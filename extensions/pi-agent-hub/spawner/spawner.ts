/**
 * spawner — Agent spawner with RPC + IPC
 *
 * Spawns pi agents in --mode rpc, giving us:
 * 1. Bidirectional stdin/stdout JSON protocol (prompt, steer, abort, get_state)
 * 2. Global extensions inherited (panopticon → IPC from any agent)
 * 3. Agent stays alive — send multiple tasks without respawning
 * 4. Two communication channels:
 *    - RPC stdin  (from parent, structured commands)
 *    - Maildir    (from any peer, via agent_send)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Registry } from "../types.js";
import {
	gracefulKill,
	type SpawnedAgent,
} from "./spawn-service.js";
import { rpcWrite } from "./spawn-rpc.js";
import { hasCompletionSignal } from "./spawn-events.js";
import type { SpawnerContext } from "./spawner-types.js";
import {
	registerSpawnAgentTool,
	registerRpcSendTool,
	registerListSpawnedTool,
	registerKillAgentTool,
} from "./spawner-tools.js";

// ── SpawnerModule interface ─────────────────────────────────────

/** Callback invoked when a spawned agent exits without sending a completion signal. */
type MissingDoneCallback = (agentName: string, pid: number, exitCode: number | null, durationMs: number) => void;

interface SpawnerModule {
	shutdownAll(): Promise<void>;
	/** Register a listener for missing-DONE detection. Returns dispose function. */
	onMissingDone(cb: MissingDoneCallback): () => void;
}

// ── Extension entry ─────────────────────────────────────────────

export function setupSpawner(pi: ExtensionAPI, registry: Registry): SpawnerModule {
	const agents = new Map<string, SpawnedAgent>();
	const signalledAgents = new Set<string>();
	const missingDoneListeners = new Set<MissingDoneCallback>();

	/** Called when a spawned agent's process exits. Checks for missing DONE. */
	function onAgentExit(agent: SpawnedAgent): void {
		if (hasCompletionSignal(agent, signalledAgents)) return;
		const durationMs = Date.now() - agent.startedAt;
		for (const cb of missingDoneListeners) {
			try { cb(agent.name, agent.pid, agent.proc.exitCode ?? null, durationMs); } catch { /* best-effort */ }
		}
	}

	const ctx: SpawnerContext = {
		agents,
		registry,
		onAgentExit,
	};

	// ── Register Tools ──────────────────────────────────────────
	registerSpawnAgentTool(pi, ctx);
	registerRpcSendTool(pi, ctx);
	registerListSpawnedTool(pi, ctx);
	registerKillAgentTool(pi, ctx);

	// ── Return module interface ─────────────────────────────────

	return {
		async shutdownAll(): Promise<void> {
			const writeAbort = (a: SpawnedAgent) => rpcWrite(a, { type: "abort" });
			const pending = [...agents.values()]
				.filter((a) => !a.done)
				.map((a) => gracefulKill(a, writeAbort));
			await Promise.all(pending);
		},

		onMissingDone(cb: MissingDoneCallback): () => void {
			missingDoneListeners.add(cb);
			return () => { missingDoneListeners.delete(cb); };
		},
	};
}

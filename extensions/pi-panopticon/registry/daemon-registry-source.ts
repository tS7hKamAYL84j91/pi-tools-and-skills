/**
 * Daemon-registry source adapter (design doc section 7): maps daemon
 * registry records to the pi-panopticon AgentRecord view model. The daemon
 * registry is the authority for identity and liveness when
 * COAS_DAEMON_ENABLED=1; daemon-managed fields it does not expose (peer PIDs,
 * cwd, model) are diagnostic-only placeholders here.
 */
import type { RegistryEntry } from "../../../daemon/src/registry.js";
import { socketPath, daemonRoots } from "../../../daemon/src/paths.js";
import type { AgentRecord } from "../types.js";
import { DaemonRegistryClient } from "../daemon-client/daemon-registry-client.js";
import { readVolatileRegistryRecords } from "./registry-reader.js";

/** Opt-in env flag (ADR-0009 deny-by-default): unset means incumbent behaviour. */
const COAS_DAEMON_ENABLED_ENV = "COAS_DAEMON_ENABLED";

/** True when this workspace renders the registry from the daemon. */
export function isDaemonRegistryEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return env[COAS_DAEMON_ENABLED_ENV] === "1";
}

/** Socket path of the daemon authority (the daemon's published socket). */
function daemonSocketPath(env: NodeJS.ProcessEnv = process.env): string {
	return socketPath(daemonRoots(env));
}

/**
 * Construct the daemon-mode read-only client when the workspace opted in
	(ADR-0009 deny-by-default): the credential is the daemon-issued admission
	capability delivered out-of-band; without one the source stays
	disconnected (fail-closed empty view — never a silent dual authority).
	Undefined when the flag is unset: the incumbent registry stays authoritative.
 */
export function createDaemonClientIfEnabled(
	env: NodeJS.ProcessEnv = process.env,
): DaemonRegistryClient | undefined {
	if (!isDaemonRegistryEnabled(env)) return undefined;
	return new DaemonRegistryClient({
		socketPath: daemonSocketPath(env),
		credential: {
			agentId: env.COAS_DAEMON_AGENT_ID ?? "",
			capabilitySecret: env.COAS_DAEMON_CAPABILITY ?? "",
		},
	});
}

/**
 * The peer-read seam (design doc section 7, no dual-write): exactly one
	registry authority per workspace state, chosen at session start. A daemon
	client attached by the wiring makes the daemon snapshot authoritative —
	not live => fail-closed empty view, never a silent fallback to the
	incumbent shared disk (the mixed-mode matrix keeps one authority per
	workspace). No attached client means the incumbent registry.
 */
export function readPeerRecords(
	externalPeers: readonly AgentRecord[],
	daemonClient: DaemonRegistryClient | undefined,
): AgentRecord[] {
	if (daemonClient !== undefined) {
		return [
			...externalPeers,
			...(daemonClient.connected
				? daemonEntriesToRecords(daemonClient.getEntries(), Date.now())
				: []),
		];
	}
	return [...externalPeers, ...readVolatileRegistryRecords()];
}

/**
 * Adapt daemon registry entries to the AgentRecord view model. The daemon
 * registry is the authority for identity, generation, and liveness; fields it
 * does not own (peer PIDs, cwd, model) stay diagnostic-only placeholders.
 * Visibility mapping is fail-closed: only an exact "global" tag maps to
 * global — everything else (including the daemon's neutral defaults) is
 * treated as scoped, the least-visible reading.
 */
export function daemonEntriesToRecords(
	entries: readonly RegistryEntry[],
	now: number,
): AgentRecord[] {
	return entries.map(
		(entry): AgentRecord => ({
			id: entry.agentId,
			name: entry.displayName,
			// Diagnostic only: the daemon registry does not expose peer PIDs (ADR section 2).
			pid: 0,
			cwd: "",
			model: "",
			startedAt: Date.parse(entry.createdAt),
			heartbeat: now,
			// Daemon liveness: a live binding means the agent is running; without
			// one the identity persists but no instance is alive.
			status: entry.liveInstanceId !== undefined ? "running" : "terminated",
			...(entry.parentId !== null ? { parentId: entry.parentId } : {}),
			visibility: visibilityTag(entry.visibility),
			kind: "pi",
		}),
	);
}

/** Fail-closed visibility mapping: only an exact "global" widens the view. */
function visibilityTag(value: string): "global" | "scoped" {
	return value === "global" ? "global" : "scoped";
}

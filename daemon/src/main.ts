/**
 * coas-daemon main entrypoint (design doc section 1, ADR-0018 implementation
 * path item 1): acquire the single-instance lock, bootstrap the integrity
 * key, publish the 0600 socket, and serve until SIGTERM/SIGINT. Graceful
 * shutdown releases the lock; the failure-threshold policy owns restarts
 * (systemd unit uses Restart=no).
 *
 * Run: node --experimental-strip-types? No — build via `tsc -p daemon/tsconfig.json`
 * is not wired for emit in the repo (typecheck-only). The launcher entrypoint
 * is this module; see daemon/README.md for the systemd/nohup instructions.
 */
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from "./lock.js";
import { loadOrCreateIntegrityKey } from "./keys.js";
import { publishDaemonSocket, type PublishedSocket } from "./socket.js";
import { appendAudit } from "./audit.js";
import { join } from "node:path";
import { daemonRoots } from "./paths.js";
import { assertLiveModeAuthorized, invalidateWriterLeaseOnRestart, loadWriterLease, tickSchedules, type TickMode } from "./schedule-tick.js";
import { DeliveryServeLoop } from "./serve.js";
import { DaemonRegistry } from "./registry.js";
import { acceptRegistrySyncConnection } from "./registry-protocol.js";
import { buildEnvelope, signEnvelope } from "./envelope.js";
import { enqueue } from "./queue.js";

export interface DaemonBootstrap {
	readonly startedAt: string;
	readonly posture: string;
	readonly keyId: string;
	readonly socketPath: string;
	readonly socket: PublishedSocket;
	readonly serve: DeliveryServeLoop;
	readonly registry: DaemonRegistry;
	/** M4 snapshot: scheduler + delivery counters for coas_status. */
	readonly snapshot: () => Record<string, unknown>;
	readonly stop: () => Promise<void>;
}

const SCHEDULER_TICK_MS = 60_000;
let schedulerTickInterval: NodeJS.Timeout | undefined;

/** Rollout mode: dry-run/claim-check first (ADR-0008 decision 8). */
function tickModeFromEnv(env: NodeJS.ProcessEnv = process.env): TickMode {
	const mode = env.COAS_DAEMON_MODE;
	return mode === "live" ? "live" : mode === "claim_check_only" ? "claim_check_only" : "dry_run";
}

/**
 * Bootstrap the daemon: lock -> key -> socket. Fails closed (process exit
 * non-zero is the caller's concern; errors propagate) when another live
 * daemon holds the lock or the socket.
 */
export async function bootstrapDaemon(roots = daemonRoots()): Promise<DaemonBootstrap> {
	const lock = await acquireSingleInstanceLock(roots);
	if (!lock.acquired) {
		// ADR section 7: the refused second instance is fail-closed AND audited.
		await appendAudit(roots, {
			kind: "daemon_start_rejected",
			reason: lock.corrupt ? "lock_state_corrupt" : "live_holder",
			...(lock.liveHolderPid !== undefined ? { holderPid: lock.liveHolderPid } : {}),
		}, { durable: true }).catch(() => {});
		throw new Error(`coas-daemon: another live daemon holds the single-instance lock (pid ${lock.liveHolderPid})`);
	}
	try {
		const keys = await loadOrCreateIntegrityKey(roots, (event) => appendAudit(roots, event, { durable: true }));
		const socket = await publishDaemonSocket(roots, (socket) => {
			// M6 registry sync: each connection runs the authenticated
			// capability-proof handshake (fail-closed) feeding complete lines
			// to the session handler.
			let buffer = "";
			const session = acceptRegistrySyncConnection({ registry }, {
				send: (line) => socket.write(line),
				close: () => socket.destroy(),
			});
			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					session.onLine(line);
					newlineIndex = buffer.indexOf("\n");
				}
			});
			socket.on("close", () => session.close());
		});
		const startedAt = new Date().toISOString();
		// M5/M6 recovery: a surviving writer lease is invalidated (re-arm) at
		// startup; queue recovery replay is idempotent (ADR section 7).
		await invalidateWriterLeaseOnRestart(roots, keys).catch(() => {});
		await appendAudit(roots, {
			kind: "daemon_started",
			posture: keys.fallbackFileUsed ? "same_uid_untrusted(key_fallback)" : "same_uid_untrusted",
			keyId: keys.keyId,
			...(lock.tookOverFrom !== undefined ? { tookOverFrom: lock.tookOverFrom } : {}),
		}, { durable: true });

		const mode: TickMode = tickModeFromEnv();
		// B3 alternative (reviewer): hold live mode closed until the T-870
		// registry seam provides registry-derived guard inputs. The registry
		// itself is recovered here (identity continuity + stale invalidation).
		assertLiveModeAuthorized(mode, false);
		const registry = await DaemonRegistry.recover(roots, {
			keyId: keys.keyId,
			privateKeyPem: keys.privateKeyPem,
			publicKeyPem: keys.publicKeyPem,
		});
		const serve = new DeliveryServeLoop(roots, (event) => appendAudit(roots, event));
		const deferralCounts = new Map<string, number>();

		const schedulerTick = async (): Promise<void> => {
			const schedulesDir = process.env.COAS_SCHEDULES_DIR ?? join(roots.stateRoot, "schedules");
			await tickSchedules(
				roots,
				{
					schedulesDir,
					mode,
					guardInputs: { parentId: null, visibility: "workspace", scope: "root" },
					writerLease: await loadWriterLease(roots, new Map([[keys.keyId, keys.publicKeyPem]])),
					deferralCounts,
					holderAlive: (agentId: string) => serve.bindingFor(agentId) !== undefined,
					deliver: async (schedule, prompt, claim) => {
						// Delivery seam (ADR-0008): the scheduled prompt is enqueued
						// as a real signed envelope via the durable queue; the serve
						// loop delivers it through the lease path when the recipient
						// binding is admitted.
						const sender = { agentId: "a-coas-daemon", instanceId: `i-sched-${schedule.taskId}`, generation: 1 };
						const envelope = buildEnvelope(keys, {
							idempotencyKey: `schedule:${schedule.taskId}:${claim.minuteKey}`,
							expiresAt: new Date(Date.now() + 3600_000),
							sender,
							recipientAgentId: `a-${schedule.workspaceId || schedule.taskId}`,
							recipientGenerationPolicy: "stable_mailbox",
							recipientGeneration: null,
							payloadType: "schedule_delivery",
							payload: prompt,
						});
						const signed = signEnvelope(keys.privateKeyPem, envelope);
						const result = await enqueue(roots, {
							signed,
							policyDecision: { allowed: true },
							verificationKeys: new Map([[keys.keyId, keys.publicKeyPem]]),
						});
						void claim;
						void result;
					},
				},
				new Date(),
				(event) => appendAudit(roots, event),
			).catch((error: unknown) => {
				void appendAudit(roots, { kind: "scheduler_tick_failed", reason: (error as Error).message });
			});
		};
		void schedulerTick().catch(() => {});
		schedulerTickInterval = setInterval(() => {
			void schedulerTick();
		}, SCHEDULER_TICK_MS);

		let stopped = false;
		const stop = async (): Promise<void> => {
			if (stopped) return;
			stopped = true;
			if (schedulerTickInterval !== undefined) clearInterval(schedulerTickInterval);
			schedulerTickInterval = undefined;
			socket.server.close();
			await releaseSingleInstanceLock(roots);
			await appendAudit(roots, { kind: "daemon_stopped" }, { durable: true });
		};
		const snapshot = (): Record<string, unknown> => ({
			posture: "same_uid_untrusted",
			mode,
			serve: serve.counters,
		});
		return { startedAt, posture: "same_uid_untrusted", keyId: keys.keyId, socketPath: socket.path, socket, serve, registry, snapshot, stop };
	} catch (error) {
		// Fail closed: never leave a lock held by a daemon that did not start.
		await releaseSingleInstanceLock(roots).catch(() => {});
		throw error;
	}
}

/** CLI entrypoint (invoked by the systemd unit / nohup): run until signalled. */
export async function runUntilSignal(roots = daemonRoots()): Promise<void> {
	const bootstrap = await bootstrapDaemon(roots);
	const shutdown = (): void => {
		void bootstrap.stop().then(() => process.exit(0), () => process.exit(1));
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}
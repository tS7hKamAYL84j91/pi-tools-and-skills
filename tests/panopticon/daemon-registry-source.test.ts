/**
 * Unit tests for the pi-panopticon daemon-registry source (T-870 slice 2):
 * the RegistryEntry -> AgentRecord adapter (fail-closed liveness, visibility,
 * parenting), the deny-by-default opt-in flag, and the full client <->
 * daemon-handler loopback (handshake, snapshot, live event deltas, resync on
 * a true gap, and bounded reconnect after a daemon drop).
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	encodeWireMessage,
	type RegistrySyncConnection,
} from "../../lib/daemon-protocol/registry-protocol.js";
import { acceptRegistrySyncConnection } from "../../daemon/src/registry-protocol.js";
import { DaemonRegistry } from "../../daemon/src/registry.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import {
	daemonEntriesToRecords,
	isDaemonRegistryEnabled,
} from "../../extensions/pi-panopticon/registry/daemon-registry-source.js";
import { DaemonRegistryClient } from "../../extensions/pi-panopticon/daemon-client/daemon-registry-client.js";
import type { DaemonRoots } from "../../lib/daemon-protocol/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "panopticon-daemon-src-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

async function cleanupRoots(roots: DaemonRoots): Promise<void> {
	await rm(roots.stateRoot, { recursive: true, force: true });
	await rm(roots.runtimeRoot, { recursive: true, force: true });
}

/** Registry with one admitted agent; returns the admission credential. */
async function makeAdmitted(roots: DaemonRoots): Promise<{
	registry: DaemonRegistry;
	agentId: string;
	capabilitySecret: string;
}> {
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	const registry = await DaemonRegistry.recover(roots, keys, {});
	const identity = await registry.registerAgent({
		displayName: "worker",
		parentId: null,
		visibility: "global",
		scope: "root",
	});
	const admitted = await registry.admit(identity.agentId);
	if (!admitted.admitted) throw new Error("expected admission in test setup");
	return {
		registry,
		agentId: admitted.agentId,
		capabilitySecret: admitted.capabilitySecret,
	};
}

/** Loopback transport: bridges the client to a real daemon-side sync session. */
function makeLoopback(registry: DaemonRegistry): {
	connect: NonNullable<
		ConstructorParameters<typeof DaemonRegistryClient>[0]["connect"]
	>;
	feedClient: (line: string) => void;
	dropConnection: () => void;
	snapshots: () => number;
} {
	let clientHandlers:
		| { readonly onLine: (line: string) => void; readonly onClose: () => void }
		| undefined;
	let daemonSession:
		| ReturnType<typeof acceptRegistrySyncConnection>
		| undefined;
	let snapshotCount = 0;
	const connect = (
		_path: string,
		handlers: { onLine: (line: string) => void; onClose: () => void },
	): RegistrySyncConnection => {
		clientHandlers = handlers;
		const session = acceptRegistrySyncConnection(
			{ registry },
			{
				send: (line: string): void => {
					for (const piece of line.split("\n")) {
						if (piece.length === 0) continue;
						if ((JSON.parse(piece) as { op?: string }).op === "snapshot")
							snapshotCount++;
						handlers.onLine(piece);
					}
				},
				close: (): void => {
					handlers.onClose();
				},
			},
		);
		daemonSession = session;
		return {
			send: (line: string): void => {
				session.onLine(line);
			},
			close: (): void => {
				session.close();
				handlers.onClose();
			},
		};
	};
	return {
		connect,
		feedClient: (line: string): void => clientHandlers?.onLine(line),
		dropConnection: (): void => daemonSession?.close(),
		snapshots: () => snapshotCount,
	};
}

function baseEntry(
	overrides: Partial<Parameters<typeof daemonEntriesToRecords>[0][number]> = {},
): Parameters<typeof daemonEntriesToRecords>[0][number] {
	return {
		agentId: "a-1",
		displayName: "worker",
		generation: 2,
		liveInstanceId: "i-1",
		parentId: "a-parent",
		visibility: "global",
		scope: "root",
		createdAt: new Date(900_000).toISOString(),
		...overrides,
	};
}

describe("daemon-registry-source adapter", () => {
	it("maps daemon entries to the AgentRecord view model", () => {
		const now = 1_000_000;
		const [live] = daemonEntriesToRecords([baseEntry()], now);
		expect(live?.id).toBe("a-1");
		expect(live?.name).toBe("worker");
		expect(live?.status).toBe("running");
		expect(live?.parentId).toBe("a-parent");
		expect(live?.visibility).toBe("global");
		expect(live?.startedAt).toBe(900_000);
		expect(live?.heartbeat).toBe(now);
		expect(live?.kind).toBe("pi");
		// Diagnostic-only placeholders: the daemon exposes no peer PIDs/cwd/model.
		expect(live?.pid).toBe(0);
		expect(live?.cwd).toBe("");
		expect(live?.model).toBe("");
	});

	it("maps a persisted-but-unbound identity as terminated with fail-closed visibility", () => {
		const now = 1_000_000;
		const [idle] = daemonEntriesToRecords(
			[
				baseEntry({
					liveInstanceId: undefined,
					parentId: null,
					visibility: "workspace",
				}),
			],
			now,
		);
		expect(idle?.status).toBe("terminated");
		expect(idle?.parentId).toBeUndefined();
		// Fail-closed visibility: only an exact "global" widens the view.
		expect(idle?.visibility).toBe("scoped");
	});

	it("the opt-in flag is deny-by-default (ADR-0009)", () => {
		expect(isDaemonRegistryEnabled({})).toBe(false);
		expect(isDaemonRegistryEnabled({ COAS_DAEMON_ENABLED: "1" })).toBe(true);
		expect(isDaemonRegistryEnabled({ COAS_DAEMON_ENABLED: "0" })).toBe(false);
	});
});

describe("M6 daemon-client loopback against the real daemon handler", () => {
	it("handshakes, receives the snapshot, and patches live event deltas", async () => {
		const roots = await makeRoots();
		try {
			const fixture = await makeAdmitted(roots);
			const loopback = makeLoopback(fixture.registry);
			const client = new DaemonRegistryClient({
				socketPath: "loopback",
				credential: {
					agentId: fixture.agentId,
					capabilitySecret: fixture.capabilitySecret,
				},
				connect: (path, handlers) => loopback.connect(path, handlers),
			});

			client.start();
			await vi.waitFor(() => expect(client.connected).toBe(true), {
				timeout: 2000,
			});
			// The snapshot carries the admitted agent; it may land a microtask
			// after hello_ok (connected flips before the snapshot is applied).
			await vi.waitFor(
				() =>
					expect(client.getEntries().map((entry) => entry.agentId)).toContain(
						fixture.agentId,
					),
				{ timeout: 2000 },
			);

			// A live registry mutation patches the client view via the event stream.
			const second = await fixture.registry.registerAgent({
				displayName: "late-joiner",
				parentId: null,
				visibility: "global",
				scope: "root",
			});
			await vi.waitFor(() => {
				expect(
					client.getEntries().some((entry) => entry.agentId === second.agentId),
				).toBe(true);
			});

			client.stop();
			expect(client.connected).toBe(false);
		} finally {
			await cleanupRoots(roots);
		}
	});

	it("resyncs from a fresh snapshot after a true seq gap", async () => {
		const roots = await makeRoots();
		try {
			const fixture = await makeAdmitted(roots);
			const loopback = makeLoopback(fixture.registry);
			const client = new DaemonRegistryClient({
				socketPath: "loopback",
				credential: {
					agentId: fixture.agentId,
					capabilitySecret: fixture.capabilitySecret,
				},
				connect: (path, handlers) => loopback.connect(path, handlers),
			});
			client.start();
			await vi.waitFor(() => expect(client.connected).toBe(true), {
				timeout: 2000,
			});
			const snapshotsBefore = loopback.snapshots();

			// A synthetic event beyond expected+1 is a true gap -> resubscribe.
			loopback.feedClient(
				encodeWireMessage({
					op: "event",
					seq: 10_000,
					kind: "identity_created",
					agentId: "a-gap",
				}),
			);

			// The daemon re-subscribes and re-serves a fresh snapshot.
			await vi.waitFor(
				() => expect(loopback.snapshots()).toBeGreaterThan(snapshotsBefore),
				{ timeout: 2000 },
			);
			expect(client.connected).toBe(true);
			client.stop();
		} finally {
			await cleanupRoots(roots);
		}
	});

	it("reconnects after the daemon drops the connection", async () => {
		const roots = await makeRoots();
		try {
			const fixture = await makeAdmitted(roots);
			const loopback = makeLoopback(fixture.registry);
			const client = new DaemonRegistryClient({
				socketPath: "loopback",
				credential: {
					agentId: fixture.agentId,
					capabilitySecret: fixture.capabilitySecret,
				},
				connect: (path, handlers) => loopback.connect(path, handlers),
			});
			client.start();
			await vi.waitFor(() => expect(client.connected).toBe(true), {
				timeout: 2000,
			});

			// The daemon drops the connection; the ladder reconnects.
			loopback.dropConnection();
			await vi.waitFor(() => expect(client.connected).toBe(true), {
				timeout: 3000,
			});
			client.stop();
		} finally {
			await cleanupRoots(roots);
		}
	});
});

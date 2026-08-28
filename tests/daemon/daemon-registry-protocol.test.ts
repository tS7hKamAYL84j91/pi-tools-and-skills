/**
 * Unit tests for the M6 registry sync protocol (T-870 slice 2): JSON-line
 * wire codec and the daemon-side connection handler's handshake state
 * machine (hello -> challenge -> proof -> hello_ok -> subscribe -> snapshot
 * + events), with fail-closed handling of malformed lines, bad proofs, and
 * wrong-stage messages.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilityProof } from "../../daemon/src/admission.js";
import {
	acceptRegistrySyncConnection,
	encodeWireMessage,
	parseWireMessage,
	type RegistrySyncConnection,
} from "../../daemon/src/registry-protocol.js";
import { DaemonRegistry } from "../../daemon/src/registry.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-sync-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

/** Registry with one admitted agent; returns the admission credential. */
async function makeAdmitted(roots: DaemonRoots): Promise<{
	registry: DaemonRegistry;
	agentId: string;
	capabilitySecret: string;
}> {
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	const registry = await DaemonRegistry.recover(roots, keys, {});
	const identity = await registry.registerAgent({ displayName: "worker", parentId: null, visibility: "global", scope: "root" });
	const admitted = await registry.admit(identity.agentId);
	if (!admitted.admitted) throw new Error("expected admission in test setup");
	return { registry, agentId: admitted.agentId, capabilitySecret: admitted.capabilitySecret };
}

/** In-memory daemon-side connection capturing replies and closure. */
function captureConnection(): {
	replies: string[];
	isClosed: () => boolean;
	connection: RegistrySyncConnection;
} {
	const replies: string[] = [];
	let closed = false;
	return {
		replies,
		isClosed: (): boolean => closed,
		connection: {
			send: (line: string): void => {
				replies.push(line);
			},
			close: (): void => {
				closed = true;
			},
		},
	};
}

type WireOp = { readonly op: string } & Record<string, unknown>;

function ops(replies: readonly string[]): WireOp[] {
	return replies.map((line) => JSON.parse(line) as Record<string, unknown> & { op: string });
}

describe("registry sync wire codec", () => {
	it("round-trips messages and rejects empty, malformed, unknown-op, and oversized lines", () => {
		const message = { op: "hello", agentId: "a-1" } as const;
		expect(parseWireMessage(encodeWireMessage(message))).toEqual(message);

		expect(parseWireMessage("")).toBeUndefined();
		expect(parseWireMessage("   ")).toBeUndefined();
		expect(parseWireMessage("{not json")).toBeUndefined();
		expect(parseWireMessage('{"op":"unknown_op"}')).toBeUndefined();
		expect(parseWireMessage('{"op":42}')).toBeUndefined();
		expect(parseWireMessage(`{"op":"hello","agentId":"${"x".repeat(70_000)}"}`)).toBeUndefined();
	});
});

describe("daemon-side sync handler (design doc section 7)", () => {
	it("handshakes hello -> challenge -> proof -> hello_ok -> subscribe -> snapshot + events", async () => {
		const roots = await makeRoots();
		try {
			const setup = await makeAdmitted(roots);
			const capture = captureConnection();
			const session = acceptRegistrySyncConnection({ registry: setup.registry }, capture.connection);

			// hello -> challenge (fresh nonce).
			session.onLine(encodeWireMessage({ op: "hello", agentId: setup.agentId }));
			expect(ops(capture.replies)).toHaveLength(1);
			const challenge = ops(capture.replies)[0];
			expect(challenge?.op).toBe("challenge");
			const nonce = challenge?.nonce;
			expect(typeof nonce).toBe("string");

			// Correct capability proof -> hello_ok.
			const proof = capabilityProof(setup.capabilitySecret, nonce as string);
			session.onLine(encodeWireMessage({ op: "hello_proof", agentId: setup.agentId, proof: proof.toString("base64") }));
			expect(ops(capture.replies)[1]?.op).toBe("hello_ok");

			// Subscribe: one atomic snapshot, then live events.
			session.onLine(encodeWireMessage({ op: "subscribe", lastSeq: 0 }));
			await vi.waitFor(() => {
				expect(ops(capture.replies).some((reply) => reply.op === "snapshot")).toBe(true);
			});
			const snapshot = ops(capture.replies).find((reply) => reply.op === "snapshot") as
				| { seq: number; entries: Array<Record<string, unknown>> }
				| undefined;
			expect(snapshot?.entries).toHaveLength(1);
			expect(snapshot?.entries[0]?.displayName).toBe("worker");

			// A registry mutation streams as an event with the post-mutation entry.
			const second = await setup.registry.registerAgent({ displayName: "second", parentId: null, visibility: "global", scope: "task" });
			await vi.waitFor(() => {
				const events = ops(capture.replies).filter((reply) => reply.op === "event");
				expect(events.some((event) => event.agentId === second.agentId)).toBe(true);
			});

			session.close();
			expect(capture.isClosed()).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("rejects a wrong capability proof fail-closed", async () => {
		const roots = await makeRoots();
		try {
			const setup = await makeAdmitted(roots);
			const capture = captureConnection();
			const session = acceptRegistrySyncConnection({ registry: setup.registry }, capture.connection);

			session.onLine(encodeWireMessage({ op: "hello", agentId: setup.agentId }));
			const challenge = ops(capture.replies)[0];
			expect(challenge?.op).toBe("challenge");

			// A proof minted from the wrong secret fails closed.
			const wrongProof = capabilityProof("not-the-secret", challenge?.nonce as string);
			session.onLine(encodeWireMessage({ op: "hello_proof", agentId: setup.agentId, proof: wrongProof.toString("base64") }));
			const replies = ops(capture.replies);
			expect(replies[1]?.op).toBe("hello_rejected");
			expect(capture.isClosed()).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("rejects subscribe-before-auth and daemon ops from the client side", async () => {
		const roots = await makeRoots();
		try {
			const setup = await makeAdmitted(roots);
			const capture = captureConnection();
			const session = acceptRegistrySyncConnection({ registry: setup.registry }, capture.connection);

			// Subscribe before any authentication fails closed.
			session.onLine(encodeWireMessage({ op: "subscribe", lastSeq: 0 }));
			expect(ops(capture.replies)[0]?.op).toBe("hello_rejected");
			expect(capture.isClosed()).toBe(true);

			// Daemon -> client ops never originate from the client side.
			const strictCapture = captureConnection();
			const strict = acceptRegistrySyncConnection({ registry: setup.registry }, strictCapture.connection);
			strict.onLine(encodeWireMessage({ op: "snapshot", seq: 1, entries: [] }));
			expect(ops(strictCapture.replies)[0]?.op).toBe("hello_rejected");
			expect(strictCapture.isClosed()).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});
/**
 * Cockpit RPC transport tests: strict LF framing, response correlation,
 * stderr isolation, and disconnect / uncertain-send semantics.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CockpitRpc, type CockpitEvent, type RpcRecord } from "../../pi-cockpit/rpc-client.ts";

const FIXTURE = join(process.cwd(), "tests/cockpit/fixtures/fake-rpc-child.ts");
const TIMEOUT_MS = 5000;

interface Harness {
	rpc: CockpitRpc;
	child: ReturnType<typeof spawn>;
	events: CockpitEvent[];
	/** Number of bytes-level write calls made to the child's stdin. */
	writeCount: () => number;
	records: () => RpcRecord[];
	stop: () => Promise<void>;
}

function start(mode: string): Harness {
	const child = spawn(process.execPath, [FIXTURE, mode], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let writes = 0;
	const originalWrite = child.stdin.write.bind(child.stdin);
	child.stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
		writes += 1;
		return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
	}) as typeof child.stdin.write;

	const events: CockpitEvent[] = [];
	const rpc = new CockpitRpc(child, {
		onEvent: (event) => {
			events.push(event);
		},
	});
	return {
		rpc,
		child,
		events,
		writeCount: () => writes,
		records: () =>
			events
				.filter((event): event is Extract<CockpitEvent, { kind: "record" }> => event.kind === "record")
				.map((event) => event.record),
		stop: () => rpc.stop(500),
	};
}

function waitFor(
	harness: Harness,
	predicate: (event: CockpitEvent) => boolean,
	timeoutMs = TIMEOUT_MS,
): Promise<CockpitEvent> {
	const existing = harness.events.find(predicate);
	if (existing !== undefined) return Promise.resolve(existing);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timed out waiting for cockpit event")), timeoutMs);
		const interval = setInterval(() => {
			const found = harness.events.find(predicate);
			if (found === undefined) return;
			clearTimeout(timer);
			clearInterval(interval);
			resolve(found);
		}, 5);
	});
}

describe("cockpit rpc transport", () => {
	it("correlates a response with its command id and clears the pending set", async () => {
		const harness = start("stream");
		try {
			const sent = harness.rpc.send({ id: "state-1", type: "get_state" });
			expect(sent).toEqual({ id: "state-1", outcome: "written" });

			await waitFor(
				harness,
				(event) =>
					event.kind === "record" &&
					event.record.type === "response" &&
					event.record.id === "state-1",
			);
			expect(harness.rpc.unansweredIds()).toEqual([]);
		} finally {
			await harness.stop();
		}
	});

	it("streams a full run in protocol order", async () => {
		const harness = start("stream");
		try {
			harness.rpc.send({ id: "prompt-1", type: "prompt", message: "hello" });
			await waitFor(
				harness,
				(event) => event.kind === "record" && event.record.type === "agent_settled",
			);

			const types = harness.records().map((record) => record.type);
			expect(types).toContain("agent_start");
			expect(types).toContain("message_start");
			expect(types).toContain("message_update");
			expect(types).toContain("tool_execution_start");
			expect(types).toContain("tool_execution_end");
			expect(types).toContain("agent_settled");

			const deltas = harness
				.records()
				.filter((record) => record.type === "message_update")
				.map((record) => {
					const update = record.assistantMessageEvent;
					if (typeof update !== "object" || update === null) return "";
					return (update as Record<string, unknown>).delta;
				});
			expect(deltas.join("")).toBe("Hello from the fake agent");
		} finally {
			await harness.stop();
		}
	});

	it("accepts CRLF and keeps U+2028 inside strings as one record", async () => {
		const harness = start("framing");
		try {
			await waitFor(
				harness,
				(event) =>
					event.kind === "record" &&
					event.record.type === "session_info_changed" &&
					event.record.name === "after-framing",
			);
			const names = harness
				.records()
				.filter((record) => record.type === "session_info_changed")
				.map((record) => record.name);
			expect(names).toContain("line\u2028separator");
			expect(harness.events.some((event) => event.kind === "parse-error")).toBe(false);
		} finally {
			await harness.stop();
		}
	});

	it("reports a malformed line without dropping the following record", async () => {
		const harness = start("broken");
		try {
			await waitFor(harness, (event) => event.kind === "parse-error");
			await waitFor(
				harness,
				(event) =>
					event.kind === "record" &&
					event.record.type === "session_info_changed" &&
					event.record.name === "after-broken",
			);
		} finally {
			await harness.stop();
		}
	});

	it("keeps stderr out of protocol parsing", async () => {
		const harness = start("noisy");
		try {
			await waitFor(
				harness,
				(event) =>
					event.kind === "record" &&
					event.record.type === "session_info_changed" &&
					event.record.name === "after-noise",
			);
			expect(harness.events.some((event) => event.kind === "stderr")).toBe(true);
			expect(harness.events.some((event) => event.kind === "parse-error")).toBe(false);
		} finally {
			await harness.stop();
		}
	});

	it("marks an unanswered in-flight command uncertain on disconnect and never retries it", async () => {
		const harness = start("die-on-prompt");
		try {
			// Wait for boot so the child is definitely reading.
			await waitFor(harness, (event) => event.kind === "record" && event.record.type === "response");

			harness.rpc.send({ id: "risky-1", type: "prompt", message: "do the thing" });
			const disconnected = await waitFor(harness, (event) => event.kind === "disconnected");
			if (disconnected.kind !== "disconnected") throw new Error("unreachable");

			expect(disconnected.uncertainIds).toEqual(["risky-1"]);
			expect(disconnected.cause).toBe("exit");
			expect(disconnected.fault).toBe(true);
			expect(harness.writeCount()).toBe(1);

			// A further send is refused outright — nothing is buffered or replayed.
			const after = harness.rpc.send({ id: "risky-2", type: "prompt", message: "retry?" });
			expect(after.outcome).toBe("refused");
			expect(harness.writeCount()).toBe(1);
			expect(harness.rpc.isDisconnected).toBe(true);
		} finally {
			await harness.stop();
		}
	});

	it("reports a failed write as uncertain, never as a refusal or a retry", async () => {
		const harness = start("slow");
		try {
			await waitFor(
				harness,
				(event) => event.kind === "record" && event.record.type === "response",
			);
			const writesBefore = harness.writeCount();
			// Force the next write to fail: bytes may or may not have reached the child.
			const stdin = harness.child.stdin;
			if (stdin === null) throw new Error("child stdin is not available");
			stdin.write = (() => {
				throw new Error("EPIPE");
			}) as typeof stdin.write;

			const sent = harness.rpc.send({ id: "maybe-1", type: "prompt", message: "do it" });
			expect(sent.outcome).toBe("uncertain");

			const disconnected = await waitFor(harness, (event) => event.kind === "disconnected");
			if (disconnected.kind !== "disconnected") throw new Error("unreachable");
			expect(disconnected.cause).toBe("write-failed");
			expect(disconnected.fault).toBe(true);
			expect(disconnected.reason).toContain("write failed");
			// No automatic retry happened.
			expect(harness.writeCount()).toBe(writesBefore);
		} finally {
			await harness.stop();
		}
	});

	it("reports a disconnect when stdout closes without an exit event", async () => {
		const harness = start("stdout-close");
		try {
			await waitFor(
				harness,
				(event) => event.kind === "record" && event.record.type === "response",
			);
			harness.rpc.send({ id: "ghost-1", type: "prompt", message: "hello" });

			const disconnected = await waitFor(harness, (event) => event.kind === "disconnected");
			if (disconnected.kind !== "disconnected") throw new Error("unreachable");
			expect(disconnected.reason).toContain("stdout closed");
			expect(disconnected.cause).toBe("stdout-closed");
			expect(disconnected.fault).toBe(true);
			expect(disconnected.uncertainIds).toEqual(["ghost-1"]);
			expect(harness.rpc.isDisconnected).toBe(true);

			// The protocol channel is gone: no further sends are accepted.
			const after = harness.rpc.send({ id: "ghost-2", type: "prompt", message: "again" });
			expect(after.outcome).toBe("refused");
		} finally {
			await harness.stop();
		}
	});

	it("closing stderr alone is not a control loss", async () => {
		const harness = start("stderr-close");
		try {
			// The child keeps answering protocol commands after closing stderr.
			harness.rpc.send({ id: "after-stderr", type: "get_state" });
			await waitFor(
				harness,
				(event) =>
					event.kind === "record" &&
					event.record.type === "response" &&
					event.record.id === "after-stderr",
			);
			expect(harness.rpc.isDisconnected).toBe(false);
			expect(harness.events.some((event) => event.kind === "disconnected")).toBe(false);

			const sent = harness.rpc.send({ id: "still-open", type: "get_state" });
			expect(sent.outcome).toBe("written");
		} finally {
			await harness.stop();
		}
	});

	it("reports an intentional stop as client-stop, not a fault", async () => {
		const harness = start("slow");
		try {
			await waitFor(
				harness,
				(event) => event.kind === "record" && event.record.type === "response",
			);
			await harness.rpc.stop(1000);
			const disconnected = harness.events.find(
				(event): event is Extract<CockpitEvent, { kind: "disconnected" }> =>
					event.kind === "disconnected",
			);
			expect(disconnected?.cause).toBe("client-stop");
			expect(disconnected?.fault).toBe(false);
		} finally {
			await harness.stop();
		}
	});

	it("escalates to SIGKILL when the child traps SIGTERM", async () => {
		const harness = start("trap-sigterm");
		try {
			await waitFor(
				harness,
				(event) => event.kind === "record" && event.record.type === "response",
			);
			const startedAt = Date.now();
			await harness.rpc.stop(100);
			const elapsed = Date.now() - startedAt;

			// Bounded: stdin EOF + SIGTERM grace + SIGKILL, not an indefinite hang.
			expect(elapsed).toBeLessThan(3000);
			expect(harness.child.signalCode).toBe("SIGKILL");
			// stop() resolves only after the reap: the OS no longer knows the pid.
			const pid = harness.child.pid;
			if (pid === undefined) throw new Error("expected a real child pid");
			expect(() => process.kill(pid, 0)).toThrow();
			const disconnected = harness.events.find(
				(event): event is Extract<CockpitEvent, { kind: "disconnected" }> =>
					event.kind === "disconnected",
			);
			expect(disconnected?.cause).toBe("client-stop");
			expect(disconnected?.fault).toBe(false);
		} finally {
			await harness.stop();
		}
	});

	it("reports a child that cannot start as spawn-error", async () => {
		const events: CockpitEvent[] = [];
		const child = spawn("/definitely-not-a-real-binary-cockpit", [], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		const rpc = new CockpitRpc(child, { onEvent: (event) => events.push(event) });
		try {
			const disconnected = await waitForEvent(events, (event) => event.kind === "disconnected");
			expect(disconnected.cause).toBe("spawn-error");
			expect(disconnected.fault).toBe(true);
		} finally {
			await rpc.stop(500);
		}
	});

	it("reports a failed script start as an exit fault, not a spawn error", async () => {
		const events: CockpitEvent[] = [];
		const child = spawn(
			process.execPath,
			[join(process.cwd(), "tests/cockpit/fixtures/does-not-exist.ts")],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		const rpc = new CockpitRpc(child, { onEvent: (event) => events.push(event) });
		try {
			const disconnected = await waitForEvent(events, (event) => event.kind === "disconnected");
			expect(disconnected.cause).toBe("exit");
			expect(disconnected.fault).toBe(true);
			expect(disconnected.exitCode).not.toBeNull();
			expect(rpc.isDisconnected).toBe(true);
		} finally {
			await rpc.stop(500);
		}
	});
});

/** Poll an event array for the first matching disconnected event. */
function waitForEvent(
	events: CockpitEvent[],
	predicate: (event: Extract<CockpitEvent, { kind: "disconnected" }>) => boolean,
	timeoutMs = TIMEOUT_MS,
): Promise<Extract<CockpitEvent, { kind: "disconnected" }>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timed out waiting for disconnect")), timeoutMs);
		const interval = setInterval(() => {
			const found = events.find(
				(event): event is Extract<CockpitEvent, { kind: "disconnected" }> =>
					event.kind === "disconnected" && predicate(event),
			);
			if (found === undefined) return;
			clearTimeout(timer);
			clearInterval(interval);
			resolve(found);
		}, 5);
	});
}

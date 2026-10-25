/**
 * Adversarial acceptance: cockpit disconnect / control-loss contract (duck-typed child).
 *
 * R37: closed cause set {exit, stdout-closed, spawn-error, write-failed}, and a
 *      closed stderr with a live stdout is telemetry only — no disconnect, no
 *      uncertain effects, no refused sends.
 * R38: written / not-sent / uncertain are distinct; a failed write is uncertain
 *      and is never labelled refused or auto-replayed.
 * R39: an orderly cockpit stop is not a fault.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CockpitRpc, type CockpitEvent } from "../../pi-cockpit/rpc-client.js";

interface Harness {
	child: EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		stdin: PassThrough;
		kill: (signal?: string) => void;
		exitCode: number | null;
		signalCode: NodeJS.Signals | null;
	};
	rpc: CockpitRpc;
	events: CockpitEvent[];
	kills: string[];
	failWrites: () => void;
}

/** `onSignal` lets a test decide whether the child honours a signal. */
function harness(onSignal?: (signal: string, child: EventEmitter) => void): Harness {
	const kills: string[] = [];
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		stdin: new PassThrough(),
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill: (signal?: string) => {
			kills.push(signal ?? "SIGTERM");
			onSignal?.(signal ?? "SIGTERM", child as unknown as EventEmitter);
		},
	});
	const events: CockpitEvent[] = [];
	const rpc = new CockpitRpc(child as unknown as ChildProcessWithoutNullStreams, {
		onEvent: (event) => events.push(event),
	});
	return {
		child,
		rpc,
		events,
		kills,
		failWrites: () => {
			child.stdin.write = (() => {
				throw new Error("EPIPE");
			}) as typeof child.stdin.write;
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Wait for one event, bounded, so a grace window does not make the test flaky. */
async function waitFor<K extends CockpitEvent["kind"]>(
	h: Harness,
	kind: K,
	timeoutMs = 1000,
): Promise<Extract<CockpitEvent, { kind: K }>> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = h.events.find((event) => event.kind === kind);
		if (found) return found as Extract<CockpitEvent, { kind: K }>;
		if (Date.now() > deadline) throw new Error(`no ${kind} event within ${timeoutMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe("cockpit control-loss acceptance", () => {
	it("reports a real exit as exit, with the exit code, after a half-close race", async () => {
		const h = harness();
		h.rpc.send({ id: "prompt-1", type: "prompt", message: "x" });
		// 'end' arrives first in the real world; the grace window must not mislabel it.
		h.child.stdout.end();
		h.child.emit("exit", 3);
		const disconnected = await waitFor(h, "disconnected");
		expect(disconnected.cause).toBe("exit");
		expect(disconnected.fault).toBe(true);
		expect(disconnected.exitCode).toBe(3);
		expect(disconnected.uncertainIds).toEqual(["prompt-1"]);
		expect(h.rpc.send({ id: "prompt-2", type: "prompt", message: "y" }).outcome).toBe("refused");
	});

	it("reports a half-close as stdout-closed after the grace window", async () => {
		const h = harness();
		h.rpc.send({ id: "prompt-4", type: "prompt", message: "w" });
		h.child.stdout.end();

		const disconnected = await waitFor(h, "disconnected");
		expect(disconnected.cause).toBe("stdout-closed");
		expect(disconnected.fault).toBe(true);
		expect(disconnected.reason).toMatch(/stdout/);
		expect(disconnected.exitCode).toBeNull();
		expect(disconnected.uncertainIds).toEqual(["prompt-4"]);
		expect(h.rpc.isDisconnected).toBe(true);
		expect(h.rpc.unansweredIds()).toEqual([]);
		expect(h.rpc.send({ id: "prompt-6b", type: "prompt", message: "after" }).outcome).toBe("refused");
	});

	it("refuses a send at once when the protocol channel closes", async () => {
		// Fixed while I was testing: control loss is now flagged before the grace
		// window, so a send during the window is refused rather than accepted into
		// a channel that can never answer it.
		const h = harness();
		h.child.stdout.end();
		const result = h.rpc.send({ id: "prompt-6", type: "prompt", message: "later" });
		await waitFor(h, "disconnected");
		expect(result.outcome).toBe("refused");
	});

	it("never silently drops a send made during the grace window: it becomes uncertain", async () => {
		const h = harness();
		h.rpc.send({ id: "prompt-6a", type: "prompt", message: "w" });
		h.child.stdout.end();
		const midWindow = h.rpc.send({ id: "prompt-6b", type: "prompt", message: "later" });
		const disconnected = await waitFor(h, "disconnected");
		if (midWindow.outcome === "written") {
			expect(disconnected.uncertainIds).toEqual(["prompt-6a", "prompt-6b"]);
		} else {
			expect(disconnected.uncertainIds).toEqual(["prompt-6a"]);
		}
	});

	it("reports a failed write as uncertain, never as refused, and never replays it", async () => {
		const h = harness();
		h.failWrites();
		const result = h.rpc.send({ id: "prompt-7", type: "prompt", message: "z" });
		expect(result.outcome).toBe("uncertain");
		expect(result.reason).toMatch(/effect unknown/);

		const disconnected = await waitFor(h, "disconnected");
		expect(disconnected.cause).toBe("write-failed");
		expect(disconnected.uncertainIds).toEqual(["prompt-7"]);
		// Refused *after* the fault, and the uncertain id is not silently cleared and retried.
		expect(h.rpc.send({ id: "prompt-8", type: "prompt", message: "again" }).outcome).toBe("refused");
	});

	it("reports a spawn error as spawn-error even when stdout closes first", async () => {
		const h = harness();
		h.child.emit("error", new Error("ENOENT"));
		h.child.stdout.end();
		const disconnected = await waitFor(h, "disconnected");
		expect(disconnected.cause).toBe("spawn-error");
		expect(disconnected.reason).toMatch(/ENOENT/);
	});

	it("reports an orderly stop as client-stop, not a fault", async () => {
		const h = harness();
		h.rpc.send({ id: "prompt-5", type: "prompt", message: "v" });
		await h.rpc.stop(10);
		const disconnected = await waitFor(h, "disconnected");
		expect(disconnected.cause).toBe("client-stop");
		expect(disconnected.fault).toBe(false);
		expect(disconnected.reason).toBe("stopped by cockpit");
	});

	it("escalates to SIGKILL when the child ignores SIGTERM, and stays bounded", async () => {
		const h = harness(); // never exits on its own; kill() records but does nothing
		const startedAt = Date.now();
		await h.rpc.stop(20);
		const elapsed = Date.now() - startedAt;
		expect(h.kills).toEqual(["SIGTERM", "SIGKILL"]);
		expect(elapsed).toBeLessThan(2500);
		const disconnected = await waitFor(h, "disconnected");
		// An operator-requested stop is still not a fault, even when it had to escalate.
		expect(disconnected.cause).toBe("client-stop");
		expect(disconnected.fault).toBe(false);
	});

	it("does not escalate when the child exits on SIGTERM", async () => {
		const h = harness((signal, child) => {
			if (signal !== "SIGTERM") return;
			h.child.exitCode = 0;
			child.emit("exit", 0, null);
		});
		await h.rpc.stop(20);
		expect(h.kills).toEqual(["SIGTERM"]);
		const disconnected = await waitFor(h, "disconnected");
		expect(disconnected.cause).toBe("client-stop");
	});

	it("waits for the reap instead of resolving once the signal is sent", async () => {
		// SIGKILL is uncatchable, so the only real variable is when the parent
		// observes the reap. This fake delays its exit so a stop() that reported
		// success at kill time would resolve measurably early.
		const h = harness((signal, child) => {
			if (signal !== "SIGTERM") return;
			setTimeout(() => {
				h.child.exitCode = 0;
				child.emit("exit", 0, null);
			}, 60);
		});
		const startedAt = Date.now();
		await h.rpc.stop(20);
		const elapsed = Date.now() - startedAt;
		expect(h.kills).toEqual(["SIGTERM"]);
		expect(elapsed).toBeGreaterThanOrEqual(50);
		expect((await waitFor(h, "disconnected")).cause).toBe("client-stop");
	});

	it("treats a closed stderr with live stdout as telemetry only", async () => {
		const h = harness();
		const sent = h.rpc.send({ id: "prompt-9", type: "prompt", message: "t" });
		h.child.stderr.end();
		await settle();
		expect(sent.outcome).toBe("written");
		expect(h.events.filter((event) => event.kind === "disconnected")).toEqual([]);
		expect(h.rpc.isDisconnected).toBe(false);
		expect(h.rpc.unansweredIds()).toEqual(["prompt-9"]);
		expect(h.rpc.send({ id: "prompt-10", type: "prompt", message: "u" }).outcome).toBe("written");
	});

	it("keeps stderr text out of protocol parsing", async () => {
		const h = harness();
		h.child.stderr.write("not json\n");
		await settle();
		expect(h.events).toEqual([{ kind: "stderr", text: "not json\n" }]);
	});

	it("splits records on LF only and tolerates CRLF", async () => {
		const h = harness();
		h.child.stdout.write('{"type":"a","note":"x\u2028y"}\r\n{"type":"b"}\n');
		await settle();
		const records = h.events.filter((event) => event.kind === "record");
		expect(records).toHaveLength(2);
	});
});

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { rpcCall } from "../../extensions/pi-agent-hub/spawner/spawn-rpc.js";
import type { SpawnedAgent } from "../../extensions/pi-agent-hub/spawner/spawn-service.js";

function fixture(
	onWrite?: (
		request: Record<string, unknown>,
		emit: (event: unknown) => void,
	) => void,
) {
	const emitter = new EventEmitter();
	const emit = (event: unknown) => emitter.emit("line", JSON.stringify(event));
	let request: Record<string, unknown> = {};
	const agent: SpawnedAgent = {
		name: "fixture",
		pid: 1,
		cwd: "/tmp",
		startedAt: 0,
		recentEvents: [],
		emitter,
		done: false,
		proc: {
			stdin: {
				writable: true,
				write(text: string) {
					request = JSON.parse(text);
					onWrite?.(request, emit);
				},
			},
		} as unknown as ChildProcess,
	};
	return { agent, emit, request: () => request };
}
describe("RPC final completion", () => {
	it.each([
		"handled",
		"rejected",
	])("subscribes before writing and finishes a %s command without a run", async (disposition) => {
		const f = fixture((request, emit) =>
			emit({
				type: "response",
				id: request.id,
				command: request.type,
				success: disposition !== "rejected",
				data: { disposition },
			}),
		);
		const result = await rpcCall(
			f.agent,
			{ type: "prompt" },
			{ waitForAgent: true },
		);
		expect(result.response?.success).toBe(disposition !== "rejected");
		expect(f.agent.emitter.listenerCount("line")).toBe(0);
	});
	it("ignores unrelated replies and intermediate errors, then waits for settled", async () => {
		const f = fixture();
		let done = false;
		const pending = rpcCall(
			f.agent,
			{ type: "prompt" },
			{ waitForAgent: true },
		).then((result) => {
			done = true;
			return result;
		});
		f.emit({
			type: "response",
			id: "other",
			command: "prompt",
			success: false,
		});
		f.emit({
			type: "response",
			id: f.request().id,
			command: "prompt",
			success: true,
			data: { disposition: "started" },
		});
		f.emit({ type: "agent_end", messages: [{ stopReason: "error" }] });
		await Promise.resolve();
		expect(done).toBe(false);
		f.emit({ type: "agent_end", messages: [{ stopReason: "stop" }] });
		await Promise.resolve();
		expect(done).toBe(false);
		f.emit({ type: "agent_settled" });
		expect((await pending).response?.success).toBe(true);
		expect(f.agent.emitter.listenerCount("line")).toBe(0);
	});
	it("retains an aborted run until it settles", async () => {
		const f = fixture((request, emit) =>
			emit({
				type: "response",
				id: request.id,
				command: request.type,
				success: true,
			}),
		);
		const pending = rpcCall(
			f.agent,
			{ type: "prompt" },
			{ waitForAgent: true },
		);
		f.emit({ type: "agent_end", messages: [{ stopReason: "aborted" }] });
		expect(f.agent.emitter.listenerCount("line")).toBe(1);
		f.emit({ type: "agent_settled" });
		await pending;
		expect(f.agent.emitter.listenerCount("line")).toBe(0);
	});
	it("cleans up a deadline without claiming completion", async () => {
		vi.useFakeTimers();
		try {
			const f = fixture();
			const pending = rpcCall(
				f.agent,
				{ type: "prompt" },
				{ waitForAgent: true, timeoutMs: 10 },
			);
			await vi.advanceTimersByTimeAsync(10);
			expect((await pending).response).toBeNull();
			expect(f.agent.emitter.listenerCount("line")).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

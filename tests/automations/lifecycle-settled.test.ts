import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerAutomationsLifecycle } from "../../extensions/pi-automations/lifecycle.js";
import type { PiScheduler } from "../../extensions/pi-automations/pi-scheduler.js";
import { runStateFromAgentEnd } from "../../extensions/pi-automations/scheduler-prompt.js";

describe("scheduled-run final settlement", () => {
	function fixture() {
		const handlers = new Map<
			string,
			(event: { messages?: unknown[] }, ctx: unknown) => unknown
		>();
		const handleAgentEnd = vi.fn(async (_messages: readonly unknown[]) => {});
		registerAutomationsLifecycle(
			{
				on: (
					name: string,
					handler: (event: { messages?: unknown[] }, ctx: unknown) => unknown,
				) => handlers.set(name, handler),
			} as unknown as ExtensionAPI,
			{ handleAgentEnd, stop: vi.fn() } as unknown as PiScheduler,
		);
		return {
			handleAgentEnd,
			emit: async (name: string, messages: unknown[] = []) => {
				await handlers.get(name)?.({ messages }, { ui: { setStatus() {} } });
			},
		};
	}
	const user = (id: string) => ({
		role: "user",
		content: `<!-- automations-scheduled-run taskId="task" runId="${id}" -->`,
	});
	it("does not finalize an intermediate error and retains markers across retries", async () => {
		const f = fixture();
		await f.emit("agent_end", [
			user("one"),
			{ role: "assistant", stopReason: "error", content: "retry" },
		]);
		expect(f.handleAgentEnd).not.toHaveBeenCalled();
		await f.emit("agent_end", [
			{ role: "assistant", stopReason: "stop", content: "DONE: recovered" },
		]);
		await f.emit("agent_settled");
		expect(f.handleAgentEnd).toHaveBeenCalledOnce();
		const messages = f.handleAgentEnd.mock.calls[0]?.[0];
		expect(
			runStateFromAgentEnd("task", "one", "fixture", messages ?? []).status,
		).toBe("complete");
		await f.emit("agent_settled");
		expect(f.handleAgentEnd).toHaveBeenCalledOnce();
	});
	it("separates queued scheduled runs and retains final cancellation", async () => {
		const f = fixture();
		await f.emit("agent_end", [
			user("one"),
			{ role: "assistant", stopReason: "stop", content: "done" },
			user("two"),
			{ role: "assistant", stopReason: "aborted" },
		]);
		await f.emit("agent_settled");
		expect(f.handleAgentEnd).toHaveBeenCalledTimes(2);
		expect(
			runStateFromAgentEnd(
				"task",
				"two",
				"fixture",
				f.handleAgentEnd.mock.calls[1]?.[0] ?? [],
			).status,
		).toBe("interrupted");
	});
	it("discards pending attempts during shutdown", async () => {
		const f = fixture();
		await f.emit("agent_end", [user("one")]);
		await f.emit("session_shutdown");
		await f.emit("agent_settled");
		expect(f.handleAgentEnd).not.toHaveBeenCalled();
	});
});

/** Tests for Panopticon peer process stopping. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { stopPeerAgent } from "../extensions/pi-panopticon/agent-stop.js";
import type { AgentRecord } from "../extensions/pi-panopticon/types.js";

const originalKill = process.kill;

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "peer-id",
		name: "peer",
		pid: 12345,
		cwd: "/tmp",
		model: "provider/model",
		startedAt: Date.now(),
		heartbeat: Date.now(),
		status: "waiting",
		pendingMessages: 0,
		...overrides,
	};
}

afterEach(() => {
	process.kill = originalKill;
});

describe("stopPeerAgent", () => {
	it("refuses to stop the current agent", () => {
		const kill = vi.fn();
		process.kill = kill as unknown as typeof process.kill;

		expect(stopPeerAgent(record({ id: "self" }), "self")).toEqual({
			accepted: false,
			error: "Refusing to stop the current agent.",
		});
		expect(kill).not.toHaveBeenCalled();
	});

	it("sends SIGTERM for a graceful stop", () => {
		const kill = vi.fn();
		process.kill = kill as unknown as typeof process.kill;

		expect(stopPeerAgent(record(), "self")).toEqual({
			accepted: true,
			method: "SIGTERM",
			pid: 12345,
		});
		expect(kill).toHaveBeenNthCalledWith(1, 12345, 0);
		expect(kill).toHaveBeenNthCalledWith(2, 12345, "SIGTERM");
	});

	it("sends SIGKILL for a forced kill", () => {
		const kill = vi.fn();
		process.kill = kill as unknown as typeof process.kill;

		expect(stopPeerAgent(record(), "self", true)).toEqual({
			accepted: true,
			method: "SIGKILL",
			pid: 12345,
		});
		expect(kill).toHaveBeenNthCalledWith(2, 12345, "SIGKILL");
	});

	it("reports a dead process without sending a signal", () => {
		const kill = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0) throw new Error("ESRCH");
		});
		process.kill = kill as unknown as typeof process.kill;

		const result = stopPeerAgent(record(), "self");

		expect(result.accepted).toBe(false);
		expect(result.error).toContain("is not running");
		expect(kill).toHaveBeenCalledOnce();
	});
});

/** Exercise child stream handling with an in-memory process, never a live agent. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnChild } from "../../extensions/pi-panopticon/spawner/spawn-service.js";

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));

function child() {
	return Object.assign(new EventEmitter(), {
		pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(),
		stdin: new PassThrough(), unref: vi.fn(), kill: vi.fn(() => true),
	});
}
let proc: ReturnType<typeof child>;
beforeEach(() => { proc = child(); mock.spawn.mockReturnValue(proc); });

function start() { return spawnChild({ name: "fixture", cwd: "/unused", args: [] }); }
function retainedBytes(events: string[]) { return events.reduce((sum, event) => sum + Buffer.byteLength(event), 0); }

describe("spawn output bounds", () => {
	it("caps stderr-only and mixed output at 100 events", () => {
		const agent = start();
		for (let i = 0; i < 1000; i++) proc.stderr.emit("data", Buffer.from(`fixture ${i}`));
		expect(agent.recentEvents).toHaveLength(100);
		expect(agent.recentEvents.at(-1)).toContain("999");
		proc.stdout.emit("data", Buffer.from('{"type":"agent_end"}\n'));
		proc.emit("close", 0);
		expect(agent.recentEvents).toHaveLength(100);
		expect(agent.recentEvents.at(-1)).toContain("exited");
	});

	it("bounds retained bytes for stderr and large valid RPC frames", () => {
		const agent = start();
		const onLine = vi.fn(); agent.emitter.on("line", onLine);
		for (let i = 0; i < 30; i++) proc.stderr.emit("data", Buffer.alloc(100_000, 120));
		expect(retainedBytes(agent.recentEvents)).toBeLessThanOrEqual(1024 * 1024);
		const line = JSON.stringify({ type: "response", value: "x".repeat(2 * 1024 * 1024) });
		proc.stdout.emit("data", Buffer.from(`${line}\n`));
		expect(onLine).toHaveBeenCalledWith(line);
		expect(retainedBytes(agent.recentEvents)).toBeLessThanOrEqual(1024 * 1024);
		expect(agent.recentEvents.at(-1)).toContain("omitted");
	});

	it("preserves Unicode and RPC framing across arbitrary chunk boundaries", () => {
		const agent = start();
		const onLine = vi.fn(); agent.emitter.on("line", onLine);
		const line = JSON.stringify({ type: "response", text: "é😀" });
		for (const byte of Buffer.from(`${line}\n\n${line}\n`)) proc.stdout.emit("data", Buffer.from([byte]));
		expect(onLine.mock.calls).toEqual([[line], [line]]);
		expect(agent.recentEvents).toEqual([line, line]);
	});

	it("accepts a frame exactly at the 8 MiB limit", () => {
		const agent = start();
		const onLine = vi.fn(); agent.emitter.on("line", onLine);
		const prefix = '{"text":"', suffix = '"}';
		const line = prefix + "x".repeat(8 * 1024 * 1024 - prefix.length - suffix.length) + suffix;
		proc.stdout.emit("data", Buffer.from(line));
		expect(onLine).not.toHaveBeenCalled();
		proc.stdout.emit("data", Buffer.from("\n"));
		expect(onLine).toHaveBeenCalledWith(line);
		expect(proc.kill).not.toHaveBeenCalled();
		expect(agent.done).toBe(false);
	});

	it.each([false, true])("terminates on an oversized stdout frame (terminated=%s)", (terminated) => {
		const agent = start();
		const onLine = vi.fn(); agent.emitter.on("line", onLine);
		for (let i = 0; i < 8; i++) proc.stdout.emit("data", Buffer.alloc(1024 * 1024, 120));
		expect(proc.kill).not.toHaveBeenCalled();
		proc.stdout.emit("data", Buffer.from(terminated ? "x\n" : "x"));
		expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
		expect(agent.done).toBe(true);
		expect(onLine).toHaveBeenCalledTimes(1);
		expect(JSON.parse(onLine.mock.calls[0]?.[0] ?? "{}")).toMatchObject({ type: "process_error" });
		proc.stdout.emit("data", Buffer.from('{"type":"response"}\n'));
		expect(onLine).toHaveBeenCalledTimes(1);
		expect(retainedBytes(agent.recentEvents)).toBeLessThan(1024);
	});
});

/**
 * Gate-command env contract: runGateCommand explicitly opts out of child
 * credential stripping, because gate commands are user-configured (other
 * owners' projects may depend on their env as rendered) and their
 * environment must stay byte-for-byte unchanged. Dummy fixtures only; the
 * spawn is mocked, no real command runs.
 */
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGateCommand } from "../../lib/gate-command.js";

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));

const STRIPPED_KEYS = [
	"MATRIX_ACCESS_TOKEN",
	"MATRIX_BOT_PASSWORD",
	"MATRIX_RECOVERY_PASSPHRASE",
	"HUB_SIDEBAR_TOKEN",
] as const;

function fakeChild() {
	return Object.assign(new EventEmitter(), {
		pid: 434343,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		stdin: new PassThrough(),
		kill: vi.fn(() => true),
	});
}

function spawnOptionsOf(): { env: NodeJS.ProcessEnv } {
	const call = mock.spawn.mock.calls[0];
	if (!call) throw new Error("spawn was not called");
	return call[2] as { env: NodeJS.ProcessEnv };
}

describe("gate commands keep the caller's env byte-for-byte", () => {
	let proc: ReturnType<typeof fakeChild>;
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		proc = fakeChild();
		mock.spawn.mockReset();
		mock.spawn.mockReturnValue(proc);
		for (const key of STRIPPED_KEYS) {
			saved.set(key, process.env[key]);
			process.env[key] = `fixture-dummy-${key.toLowerCase()}-value`;
		}
	});

	afterEach(() => {
		for (const key of STRIPPED_KEYS) {
			const original = saved.get(key);
			if (original === undefined) delete process.env[key];
			else process.env[key] = original;
		}
	});

	it("passes credential keys through to the gate child unchanged", async () => {
		const pending = runGateCommand("exit 0", tmpdir());
		proc.emit("close", 0);
		const gate = await pending;
		expect(gate.passed).toBe(true);

		const opts = spawnOptionsOf();
		for (const key of STRIPPED_KEYS) {
			expect(opts.env[key]).toBe(`fixture-dummy-${key.toLowerCase()}-value`);
		}
		// The gate command itself is the sh -c wrapper, unchanged.
		const call = mock.spawn.mock.calls[0];
		if (!call) throw new Error("spawn was not called");
		expect(call[0]).toBe("sh");
		expect(call[1]).toEqual(["-c", "exit 0"]);
	});
});

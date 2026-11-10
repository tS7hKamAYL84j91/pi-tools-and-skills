/**
 * Team-member child env boundary: one-shot `pi --print` model children
 * (llm-council / navigator / deep-research members) are model helpers with
 * tool access, so the runtime substrate must not hand them the parent's
 * Matrix credentials by default. Dummy fixtures only; the spawn is mocked,
 * no real command runs.
 */
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		pid: 424242,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		stdin: new PassThrough(),
		kill: vi.fn(() => true),
	});
}

function spawnOptionsOf(index = 0): { env: NodeJS.ProcessEnv } {
	const call = mock.spawn.mock.calls[index];
	if (!call) throw new Error("spawn was not called");
	return call[2] as { env: NodeJS.ProcessEnv };
}

describe("team member children are not handed Matrix credentials", () => {
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

	it("strips credential keys while member routing vars survive", async () => {
		const { runMember } = await import(
			"../../extensions/pi-team-workflows/runner.js"
		);
		const pending = runMember(
			{ label: "Member", model: "test/model" },
			{
				prompt: "fixture prompt",
				systemPrompt: "fixture system prompt",
				cwd: tmpdir(),
				parentId: "85747-fixture-lead",
			},
		);
		proc.stdout.emit("data", Buffer.from("member output\n"));
		proc.emit("close", 0);
		const run = await pending;
		expect(run.output).toBe("member output");

		const opts = spawnOptionsOf();
		for (const key of STRIPPED_KEYS) expect(opts.env[key]).toBeUndefined();
		// Routing/lockfile vars the member legitimately needs still survive.
		expect(opts.env.PI_PANOPTICON_PARENT_ID).toBe("85747-fixture-lead");
		expect(opts.env.AUTOMATIONS_PI_LOCKFILE_CONTINUE).toBe("1");
		// The parent's own env is untouched.
		expect(process.env.MATRIX_ACCESS_TOKEN).toBe(
			"fixture-dummy-matrix_access_token-value",
		);
	});

	it("strips even when the caller's env override names a credential key", async () => {
		const { spawnRuntimeChildProcess } = await import(
			"../../lib/runtime-child-process.js"
		);
		const pending = spawnRuntimeChildProcess({
			label: "fixture direct",
			command: "fixture-command",
			args: [],
			cwd: tmpdir(),
			env: { MATRIX_ACCESS_TOKEN: "fixture-dummy-override-token", HUB_SIDEBAR_TOKEN: "fixture-sidebar-capability" },
		});
		proc.emit("close", 0);
		await pending;
		const opts = spawnOptionsOf();
		expect(opts.env.MATRIX_ACCESS_TOKEN).toBeUndefined();
		expect(opts.env.HUB_SIDEBAR_TOKEN).toBeUndefined();
	});
});

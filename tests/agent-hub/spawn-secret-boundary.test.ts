/**
 * Spawner boundary tests: dummy-secret fixtures prove that secret-shaped
 * values never reach child argv, session-dir paths, or parent-visible spawn
 * output/model context. No live credentials are used anywhere here.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildArgList, safeSessionSlug } from "../../extensions/pi-agent-hub/spawner/spawn-service.js";
import { recentOutputFromEvents } from "../../extensions/pi-agent-hub/spawner/spawn-events.js";
import { CHILD_CREDENTIAL_ENV_KEYS } from "../../lib/child-env.js";
import { spawnChild } from "../../extensions/pi-agent-hub/spawner/spawn-service.js";

// ── Dummy fixtures only — never real credential material ─────────

const DUMMY_TOKEN = "syt_fixture_dummy_token_value_9876";
const DUMMY_API_KEY = "fixture-dummy-api-key-4242";
const DUMMY_BEARER = "Bearer fixture_dummy_bearer_31337";
const DUMMY_PASSWORD = "fixture-dummy-pw-1357";

describe("spawn argv and session-dir boundaries", () => {
	it("keeps secret-shaped model strings out of child argv", () => {
		const argv = buildArgList({
			name: "researcher",
			model: `provider/model?token=${DUMMY_TOKEN}`,
			tools: [],
		});
		expect(argv.join(" ")).not.toContain(DUMMY_TOKEN);
		expect(argv).not.toContain(`--models`);
	});

	it("passes valid model ids through argv unchanged", () => {
		const argv = buildArgList({ name: "researcher", model: "ollama/glm-5.3:cloud", tools: [] });
		expect(argv).toContain("--models");
		expect(argv).toContain("ollama/glm-5.3:cloud");
	});

	it("drops secret-shaped or invalid tool names from argv", () => {
		const argv = buildArgList({
			name: "researcher",
			tools: ["read", `bash;echo ${DUMMY_API_KEY}`, "edit"],
		});
		expect(argv).toContain("--tools");
		expect(argv.join(" ")).not.toContain(DUMMY_API_KEY);
	});

	it("slugs spawn names so session dirs cannot traverse out of subagents/", () => {
		expect(safeSessionSlug("researcher")).toBe("researcher");
		expect(safeSessionSlug("a/b/c")).toBe("a-b-c");
		expect(safeSessionSlug("")).toBe("agent");

		const argv = buildArgList({ name: "../../../../tmp/evil", tools: [] });
		const dirArg = argv[argv.indexOf("--session-dir") + 1];
		if (dirArg === undefined) throw new Error("--session-dir missing from argv");
		const dir = dirArg;
		const prefix = join(homedir(), ".pi", "agent", "sessions", "subagents");
		expect(dir.startsWith(prefix)).toBe(true);
		const rest = dir.slice(prefix.length + 1);
		expect(rest).not.toContain("/");
		expect([".", ".."].includes(rest)).toBe(false);
		expect(dir.startsWith(join(homedir(), ".pi"))).toBe(true);
		// The parent-provided sessionDir remains an explicit caller choice.
		const explicit = join(tmpdir(), "explicit-sessions");
		expect(
			buildArgList({ name: "x", sessionDir: explicit, tools: [] }),
		).toContain(explicit);
	});
});

// ── Spawn-output redaction (dummy fixtures) ───────────────────────

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));

function fakeChild() {
	return Object.assign(new EventEmitter(), {
		pid: 23456,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		stdin: new PassThrough(),
		unref: vi.fn(),
		kill: vi.fn(() => true),
	});
}

describe("spawn output redaction", () => {
	let proc: ReturnType<typeof fakeChild>;
	beforeEach(() => {
		proc = fakeChild();
		mock.spawn.mockReturnValue(proc);
	});

	it("redacts secret-shaped child output surfaced to the parent model context", () => {
		const agent = spawnChild({ name: "fixture", cwd: "/unused", args: [] });

		proc.stderr.emit("data", Buffer.from(`MATRIX_ACCESS_TOKEN=${DUMMY_TOKEN}`));
		proc.stdout.emit(
			"data",
			Buffer.from(`{"type":"tool_execution_start","toolName":"bash","args":{"command":"curl -H 'Authorization: ${DUMMY_BEARER}' https://fixture.example"}}\n`),
		);
		proc.stdout.emit("data", Buffer.from(`trailing api_key=${DUMMY_API_KEY} password=${DUMMY_PASSWORD}\n`));

		const output = recentOutputFromEvents(agent.recentEvents, 20);
		expect(output).toContain("[REDACTED]");
		expect(output).not.toContain(DUMMY_TOKEN);
		expect(output).not.toContain(DUMMY_BEARER);
		expect(output).not.toContain(DUMMY_API_KEY);
		expect(output).not.toContain(DUMMY_PASSWORD);
	});
});

// ── Child env credential boundary (dummy fixtures) ──────────────

const STRIPPED_KEYS = [
	"MATRIX_ACCESS_TOKEN",
	"MATRIX_BOT_PASSWORD",
	"MATRIX_RECOVERY_PASSPHRASE",
];

function spawnOptionsOf(index = 0): { env: NodeJS.ProcessEnv } {
	const call = mock.spawn.mock.calls[index];
	if (!call) throw new Error("spawn was not called");
	return call[2] as { env: NodeJS.ProcessEnv };
}

/** Overwrite the three credential keys with dummies, restoring prior values. */
function withDummyCredentials(run: () => void): void {
	const saved = new Map<string, string | undefined>();
	for (const key of STRIPPED_KEYS) {
		saved.set(key, process.env[key]);
		process.env[key] = `fixture-dummy-${key.toLowerCase()}-value`;
	}
	try {
		run();
	} finally {
		for (const key of STRIPPED_KEYS) {
			const original = saved.get(key);
			if (original === undefined) delete process.env[key];
			else process.env[key] = original;
		}
	}
}

describe("child env credential boundary", () => {
	let proc: ReturnType<typeof fakeChild>;
	beforeEach(() => {
		proc = fakeChild();
		mock.spawn.mockReset();
		mock.spawn.mockReturnValue(proc);
	});

	it("strips exactly the three Matrix credential key names", () => {
		expect([...CHILD_CREDENTIAL_ENV_KEYS]).toEqual(STRIPPED_KEYS);
	});

	it("does not hand the parent's Matrix credentials to the child by default", () => {
		withDummyCredentials(() => {
			spawnChild({ name: "helper", cwd: "/unused", args: [] });
			const opts = spawnOptionsOf();
			for (const key of STRIPPED_KEYS) expect(opts.env[key]).toBeUndefined();
			// The spawn never mutates the parent's own process env.
			expect(process.env.MATRIX_ACCESS_TOKEN).toBe(
				"fixture-dummy-matrix_access_token-value",
			);
		});
	});

	it("sanitizes an explicit caller env and leaves the caller's object untouched", () => {
		const callerEnv: NodeJS.ProcessEnv = {
			PATH: "/usr/bin:/bin",
			HOME: "/home/fixture",
			PI_PANOPTICON_PARENT_ID: "85747-fixture-lead",
			PI_PANOPTICON_NAMESPACE: "eo-agent-comms-gm",
			PI_PANOPTICON_SPAWN_NAME: "helper",
			MATRIX_ACCESS_TOKEN: DUMMY_TOKEN,
			MATRIX_BOT_PASSWORD: DUMMY_PASSWORD,
			MATRIX_RECOVERY_PASSPHRASE: "fixture-dummy-recovery",
		};
		spawnChild({ name: "helper", cwd: "/unused", args: [], env: callerEnv });
		const opts = spawnOptionsOf();
		for (const key of STRIPPED_KEYS) expect(opts.env[key]).toBeUndefined();
		// Ordinary and panopticon routing vars survive into the child.
		expect(opts.env.PATH).toBe("/usr/bin:/bin");
		expect(opts.env.HOME).toBe("/home/fixture");
		expect(opts.env.PI_PANOPTICON_PARENT_ID).toBe("85747-fixture-lead");
		expect(opts.env.PI_PANOPTICON_NAMESPACE).toBe("eo-agent-comms-gm");
		expect(opts.env.PI_PANOPTICON_SPAWN_NAME).toBe("helper");
		// The caller-owned env object is not mutated either.
		expect(callerEnv.MATRIX_ACCESS_TOKEN).toBe(DUMMY_TOKEN);
		expect(callerEnv.MATRIX_BOT_PASSWORD).toBe(DUMMY_PASSWORD);
	});

	it("keeps stripping across repeated spawns (no hidden state between calls)", () => {
		withDummyCredentials(() => {
			spawnChild({ name: "one", cwd: "/unused", args: [] });
			spawnChild({ name: "two", cwd: "/unused", args: [] });
			for (const index of [0, 1]) {
				const opts = spawnOptionsOf(index);
				for (const key of STRIPPED_KEYS) expect(opts.env[key]).toBeUndefined();
			}
		});
	});
});
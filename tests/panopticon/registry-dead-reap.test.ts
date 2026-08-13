/**
 * Regression: terminated agents must drop from readAllPeers immediately.
 *
 * Mocks node:fs and process.kill so no real registry directory or processes
 * are touched. Verifies the path that powers agent_peek / agent_status.
 */

import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockedFunction,
} from "vitest";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	chmodSync: vi.fn(),
	lstatSync: vi.fn(() => ({
		isSymbolicLink: () => false,
		isDirectory: () => true,
		isFile: () => true,
		mode: 0o600,
	})),
	readdirSync: vi.fn(() => []),
	readFileSync: vi.fn(),
	unlinkSync: vi.fn(),
	rmSync: vi.fn(),
	appendFileSync: vi.fn(),
}));

vi.mock("../../../lib/private-local-mode.js", () => ({
	ensurePrivateFileForRead: vi.fn(),
	assertPrivateFileTarget: vi.fn(),
	writeNewPrivateFileSync: vi.fn(),
}));

import * as nodefs from "node:fs";
import { onAgentCleanup, type AgentRecord } from "../../lib/agent-registry.js";
import Registry from "../../extensions/pi-panopticon/registry/registry.js";

const mockReaddirSync = nodefs.readdirSync as MockedFunction<typeof nodefs.readdirSync>;
const mockReadFileSync = nodefs.readFileSync as MockedFunction<typeof nodefs.readFileSync>;
const mockUnlinkSync = nodefs.unlinkSync as MockedFunction<typeof nodefs.unlinkSync>;
const mockAppendFileSync = nodefs.appendFileSync as MockedFunction<typeof nodefs.appendFileSync>;

const origKill = process.kill;
let alivePids: Set<number>;

beforeEach(() => {
	vi.resetAllMocks();
	(nodefs.existsSync as MockedFunction<typeof nodefs.existsSync>).mockReturnValue(true);
	alivePids = new Set();

	process.kill = ((pid: number, signal?: string | number) => {
		if (signal === 0 || signal === undefined) {
			if (alivePids.has(pid)) return true;
			const err = new Error("ESRCH") as NodeJS.ErrnoException;
			err.code = "ESRCH";
			throw err;
		}
		return origKill.call(process, pid, signal);
	}) as typeof process.kill;
});

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = Date.now();
	return {
		id: "agent-123",
		name: "test-agent",
		pid: 99999,
		cwd: "/tmp/test",
		model: "test/model",
		startedAt: now - 60_000,
		heartbeat: now - 1_000,
		status: "waiting",
		...overrides,
	};
}

describe("Registry.readAllPeers dead-agent reaping", () => {
	it("rejects external records injected through the volatile registry", () => {
		const agentId = "forged-external";
		const record = makeRecord({
			id: agentId,
			kind: "external",
			pid: process.pid,
			mailboxPath: "/tmp/forged-external-mailbox",
		});
		mockReaddirSync.mockReturnValue([`${agentId}.json`] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync.mockReturnValue(JSON.stringify(record) as unknown as ReturnType<typeof nodefs.readFileSync>);

		const registry = new Registry("self-id");

		expect(registry.readAllPeers()).toEqual([]);
		expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining(`${agentId}.json`));
	});

	it("includes the current workspace external peer snapshot", () => {
		const external: AgentRecord = {
			id: "ext-agent-123",
			name: "external-worker",
			kind: "external",
			pid: 0,
			cwd: "/persist/external-worker/inbox",
			model: "external",
			startedAt: 1,
			heartbeat: 1,
			status: "waiting",
			mailboxPath: "/persist/external-worker/inbox",
		};
		const registry = new Registry("self-id");
		registry.setExternalPeers([external]);

		expect(registry.readAllPeers()).toContainEqual(external);
	});

	it("drops a terminated agent even when its heartbeat is still fresh", () => {
		const deadPid = 99_999;
		const agentId = "dead-agent-123";
		const record = makeRecord({ id: agentId, name: "dead-agent", pid: deadPid });
		const cleanupHook = vi.fn();
		const disposeCleanupHook = onAgentCleanup(cleanupHook);

		mockReaddirSync.mockReturnValue([`${agentId}.json`] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync.mockReturnValue(JSON.stringify(record) as unknown as ReturnType<typeof nodefs.readFileSync>);

		try {
			const registry = new Registry("self-id");
			const peers = registry.readAllPeers();

			expect(peers).toHaveLength(0);
			expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
			expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining(`${agentId}.json`));
			expect(mockAppendFileSync).toHaveBeenCalled();
			expect(cleanupHook).toHaveBeenCalledWith(agentId);
		} finally {
			disposeCleanupHook();
		}
	});

	it("marks a stale record with a live process as stalled", () => {
		const livePid = 99_996;
		alivePids.add(livePid);
		const record = makeRecord({ heartbeat: Date.now() - 31_000, pid: livePid });
		mockReaddirSync.mockReturnValue(["agent-123.json"] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync.mockReturnValue(JSON.stringify(record) as unknown as ReturnType<typeof nodefs.readFileSync>);

		const registry = new Registry("self-id");

		expect(registry.readAllPeers()).toEqual([expect.objectContaining({ status: "stalled" })]);
		expect(mockUnlinkSync).not.toHaveBeenCalled();
	});

	it("keeps a live agent with a fresh heartbeat", () => {
		const livePid = 99_998;
		alivePids.add(livePid);
		const agentId = "live-agent-123";
		const record = makeRecord({ id: agentId, name: "live-agent", pid: livePid });

		mockReaddirSync.mockReturnValue([`${agentId}.json`] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync.mockReturnValue(JSON.stringify(record) as unknown as ReturnType<typeof nodefs.readFileSync>);

		const registry = new Registry("self-id");
		const peers = registry.readAllPeers();

		expect(peers).toHaveLength(1);
		expect(peers[0]?.id).toBe(agentId);
		expect(mockUnlinkSync).not.toHaveBeenCalled();
	});

	it("is idempotent: reaping an already-removed file does not throw", () => {
		const deadPid = 99_997;
		const agentId = "missing-agent-123";
		const record = makeRecord({ id: agentId, name: "missing-agent", pid: deadPid });

		mockReaddirSync.mockReturnValue([`${agentId}.json`] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync.mockReturnValue(JSON.stringify(record) as unknown as ReturnType<typeof nodefs.readFileSync>);
		mockUnlinkSync.mockImplementation(() => {
			const err = new Error("ENOENT") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			throw err;
		});

		const registry = new Registry("self-id");
		expect(() => registry.readAllPeers()).not.toThrow();
		expect(registry.readAllPeers()).toHaveLength(0);
	});
});

/**
 * Tests for MaildirTransport (lib/transports/maildir.ts)
 *
 * Mocks node:fs — no real filesystem touched.
 * The inbox helpers are now private to maildir.ts and exercised via the public API.
 */

import {
	beforeEach,
	describe,
	expect,
	it,
	type MockedFunction,
	vi,
} from "vitest";

vi.mock("../lib/agent-registry.js", () => ({
	REGISTRY_DIR: "/fake/.pi/agents",
}));

vi.mock("node:fs", () => ({
	mkdirSync: vi.fn(),
	writeFileSync: vi.fn(),
	readFileSync: vi.fn(),
	readdirSync: vi.fn(),
	renameSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
	randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import * as nodefs from "node:fs";
import type { AgentRecord } from "../lib/agent-registry.js";
import type { MessageTransport } from "../lib/message-transport.js";
import { createMaildirTransport } from "../lib/transports/maildir.js";

const mockMkdirSync = nodefs.mkdirSync as MockedFunction<
	typeof nodefs.mkdirSync
>;
const mockWriteFileSync = nodefs.writeFileSync as MockedFunction<
	typeof nodefs.writeFileSync
>;
// Pin to the string-returning overload to avoid Buffer overload ambiguity
const mockReadFileSync = nodefs.readFileSync as unknown as MockedFunction<
	(path: string, enc: BufferEncoding) => string
>;
const mockReaddirSync = nodefs.readdirSync as MockedFunction<
	typeof nodefs.readdirSync
>;
const mockRenameSync = nodefs.renameSync as MockedFunction<
	typeof nodefs.renameSync
>;
const mockUnlinkSync = nodefs.unlinkSync as MockedFunction<
	typeof nodefs.unlinkSync
>;

const PEER: AgentRecord = {
	id: "peer-id",
	name: "alice",
	pid: 999,
	cwd: "/",
	model: "x",
	heartbeat: Date.now(),
	startedAt: Date.now(),
	status: "running",
};

let transport: MessageTransport;

beforeEach(() => {
	vi.resetAllMocks();
	mockReaddirSync.mockReturnValue([]);
	transport = createMaildirTransport();
});

// ── send ────────────────────────────────────────────────────────

describe("send", () => {
	it("writes to maildir and returns accepted", async () => {
		const result = await transport.send(PEER, "me", "hello");
		expect(result.accepted).toBe(true);
		expect(result.immediate).toBe(false);
		expect(result.reference).toMatch(/test-uuid-1234\.json$/);
	});

	it("returns not accepted when write fails", async () => {
		mockWriteFileSync.mockImplementation(() => {
			throw new Error("ENOSPC");
		});
		const result = await transport.send(PEER, "me", "hello");
		expect(result.accepted).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("writes to correct peer inbox", async () => {
		await transport.send(PEER, "me", "hello");
		expect(mockMkdirSync).toHaveBeenCalledWith(
			expect.stringContaining("peer-id"),
			{ recursive: true },
		);
	});

	it("creates tmp, new, cur subdirectories via ensureInbox", async () => {
		await transport.send(PEER, "me", "hello");
		expect(mockMkdirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/peer-id/inbox/tmp",
			{ recursive: true },
		);
		expect(mockMkdirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/peer-id/inbox/new",
			{ recursive: true },
		);
		expect(mockMkdirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/peer-id/inbox/cur",
			{ recursive: true },
		);
	});
});

// ── receive ─────────────────────────────────────────────────────

describe("receive", () => {
	it("returns empty when no messages", () => {
		expect(transport.receive("my-id")).toEqual([]);
	});

	it("reads from the correct inbox/new directory", () => {
		transport.receive("my-id");
		expect(mockReaddirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/new",
		);
	});

	it("maps inbox messages using filename as id", () => {
		mockReaddirSync.mockReturnValue([
			"001.json",
			"002.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync
			.mockReturnValueOnce('{"id":"x","from":"alice","text":"ping","ts":1}')
			.mockReturnValueOnce('{"id":"y","from":"bob","text":"pong","ts":2}');
		const msgs = transport.receive("my-id");
		expect(msgs).toHaveLength(2);
		expect(msgs[0]).toEqual({
			id: "001.json",
			from: "alice",
			text: "ping",
			ts: 1,
		});
		expect(msgs[1]).toEqual({
			id: "002.json",
			from: "bob",
			text: "pong",
			ts: 2,
		});
	});

	it("skips files that fail to parse", () => {
		mockReaddirSync.mockReturnValue([
			"001.json",
			"bad.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockReadFileSync
			.mockReturnValueOnce('{"id":"x","from":"alice","text":"ping","ts":1}')
			.mockReturnValueOnce("not-valid-json");
		const msgs = transport.receive("my-id");
		expect(msgs).toHaveLength(1);
	});
});

// ── ack ──────────────────────────────────────────────────────────

describe("ack", () => {
	it("renames file from new/ to cur/ via inboxAcknowledge", () => {
		transport.ack("my-id", "001.json");
		expect(mockRenameSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/new/001.json",
			"/fake/.pi/agents/my-id/inbox/cur/001.json",
		);
	});
});

// ── prune ────────────────────────────────────────────────────────

describe("prune", () => {
	it("reads cur/ directory", () => {
		transport.prune("my-id");
		expect(mockReaddirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/cur",
		);
	});

	it("deletes files beyond the keep limit (default 50)", () => {
		// 52 files, keep=50 → delete the 2 oldest
		const files = Array.from(
			{ length: 52 },
			(_, i) => `${String(i).padStart(3, "0")}.json`,
		);
		mockReaddirSync.mockReturnValue(
			files as unknown as ReturnType<typeof nodefs.readdirSync>,
		);
		transport.prune("my-id");
		expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
		expect(mockUnlinkSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/cur/000.json",
		);
		expect(mockUnlinkSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/cur/001.json",
		);
	});

	it("does not delete files when within keep limit", () => {
		mockReaddirSync.mockReturnValue([
			"001.json",
			"002.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);
		transport.prune("my-id");
		expect(mockUnlinkSync).not.toHaveBeenCalled();
	});
});

// ── init ────────────────────────────────────────────────────────

describe("init", () => {
	it("creates inbox subdirectories via ensureInbox", () => {
		transport.init("my-id");
		expect(mockMkdirSync).toHaveBeenCalledTimes(3);
		expect(mockMkdirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/tmp",
			{ recursive: true },
		);
		expect(mockMkdirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/new",
			{ recursive: true },
		);
		expect(mockMkdirSync).toHaveBeenCalledWith(
			"/fake/.pi/agents/my-id/inbox/cur",
			{ recursive: true },
		);
	});
});

// ── pendingCount ─────────────────────────────────────────────────

describe("pendingCount", () => {
	it("returns 0 when no messages", () => {
		mockReaddirSync.mockReturnValue([]);
		expect(transport.pendingCount("my-id")).toBe(0);
	});

	it("counts .json files in new/ directory", () => {
		mockReaddirSync.mockReturnValue([
			"001.json",
			"002.json",
			"003.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);
		expect(transport.pendingCount("my-id")).toBe(3);
	});

	it("ignores non-json files", () => {
		mockReaddirSync.mockReturnValue([
			"001.json",
			"readme.txt",
			"002.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);
		expect(transport.pendingCount("my-id")).toBe(2);
	});

	it("returns 0 on error (directory not found)", () => {
		mockReaddirSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		expect(transport.pendingCount("my-id")).toBe(0);
	});
});

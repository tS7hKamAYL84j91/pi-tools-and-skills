/**
 * Tests for MaildirTransport (lib/transports/maildir.ts)
 *
 * Mocks agent-registry and node:fs — no real filesystem touched.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

vi.mock("../lib/agent-registry.js", () => ({
	REGISTRY_DIR: "/fake/.pi/agents",
	ensureInbox: vi.fn(),
	inboxReadNew: vi.fn(),
	inboxAcknowledge: vi.fn(),
	inboxPruneCur: vi.fn(),
}));

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
	renameSync: vi.fn(),
	readdirSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
	randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import * as registry from "../lib/agent-registry.js";
import * as nodefs from "node:fs";
import { createMaildirTransport } from "../lib/transports/maildir.js";
import type { MessageTransport } from "../lib/message-transport.js";
import type { AgentRecord } from "../lib/agent-registry.js";

const mockEnsureInbox = registry.ensureInbox as MockedFunction<typeof registry.ensureInbox>;
const mockInboxReadNew = registry.inboxReadNew as MockedFunction<typeof registry.inboxReadNew>;
const mockInboxAck = registry.inboxAcknowledge as MockedFunction<typeof registry.inboxAcknowledge>;
const mockInboxPrune = registry.inboxPruneCur as MockedFunction<typeof registry.inboxPruneCur>;
const mockWriteFileSync = nodefs.writeFileSync as MockedFunction<typeof nodefs.writeFileSync>;
const mockReaddirSync = nodefs.readdirSync as MockedFunction<typeof nodefs.readdirSync>;

const PEER: AgentRecord = {
	id: "peer-id", name: "alice", pid: 999, cwd: "/", model: "x",
	heartbeat: Date.now(), startedAt: Date.now(), status: "running",
};

let transport: MessageTransport;

beforeEach(() => {
	vi.resetAllMocks();
	mockEnsureInbox.mockReturnValue("/fake/inbox");
	mockInboxReadNew.mockReturnValue([]);
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
		mockWriteFileSync.mockImplementation(() => { throw new Error("ENOSPC"); });
		const result = await transport.send(PEER, "me", "hello");
		expect(result.accepted).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("writes to correct peer inbox", async () => {
		await transport.send(PEER, "me", "hello");
		expect(mockEnsureInbox).toHaveBeenCalledWith("peer-id");
	});
});

// ── receive ─────────────────────────────────────────────────────

describe("receive", () => {
	it("returns empty when no messages", () => {
		expect(transport.receive("my-id")).toEqual([]);
	});

	it("maps inbox messages using filename as id", () => {
		mockInboxReadNew.mockReturnValue([
			{ filename: "001.json", message: { id: "x", from: "alice", text: "ping", ts: 1 } },
			{ filename: "002.json", message: { id: "y", from: "bob", text: "pong", ts: 2 } },
		]);
		const msgs = transport.receive("my-id");
		expect(msgs).toHaveLength(2);
		expect(msgs[0]).toEqual({ id: "001.json", from: "alice", text: "ping", ts: 1 });
		expect(msgs[1]).toEqual({ id: "002.json", from: "bob", text: "pong", ts: 2 });
	});
});

// ── ack / prune / init ──────────────────────────────────────────

describe("ack", () => {
	it("delegates to inboxAcknowledge", () => {
		transport.ack("my-id", "001.json");
		expect(mockInboxAck).toHaveBeenCalledWith("my-id", "001.json");
	});
});

describe("prune", () => {
	it("delegates to inboxPruneCur", () => {
		transport.prune("my-id");
		expect(mockInboxPrune).toHaveBeenCalledWith("my-id");
	});
});

describe("init", () => {
	it("delegates to ensureInbox", () => {
		transport.init("my-id");
		expect(mockEnsureInbox).toHaveBeenCalledWith("my-id");
	});
});

// ── pendingCount ─────────────────────────────────────────────────

describe("pendingCount", () => {
	it("returns 0 when no messages", () => {
		mockReaddirSync.mockReturnValue([]);
		expect(transport.pendingCount("my-id")).toBe(0);
	});

	it("counts .json files in new/ directory", () => {
		mockReaddirSync.mockReturnValue(["001.json", "002.json", "003.json"] as any);
		expect(transport.pendingCount("my-id")).toBe(3);
	});

	it("ignores non-json files", () => {
		mockReaddirSync.mockReturnValue(["001.json", "readme.txt", "002.json"] as any);
		expect(transport.pendingCount("my-id")).toBe(2);
	});

	it("returns 0 on error (directory not found)", () => {
		mockReaddirSync.mockImplementation(() => { throw new Error("ENOENT"); });
		expect(transport.pendingCount("my-id")).toBe(0);
	});
});

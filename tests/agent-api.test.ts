/**
 * Tests for agent-api.ts (lib/agent-api.ts)
 *
 * Mocks the underlying registry and transport.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/agent-registry.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../lib/agent-registry.js")>();
	return {
		...orig,
		REGISTRY_DIR: "/fake/.pi/agents",
		isPidAlive: vi.fn(() => true),
	};
});

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	renameSync: vi.fn(),
	rmSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

import * as nodefs from "node:fs";
import { isPidAlive } from "../lib/agent-registry.js";
import { findAgentByName, sendAgentMessage } from "../lib/agent-api.js";

const mockIsPidAlive = isPidAlive as ReturnType<typeof vi.fn>;
const mockExistsSync = nodefs.existsSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = nodefs.readdirSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = nodefs.readFileSync as ReturnType<typeof vi.fn>;

const AGENT_JSON = JSON.stringify({
	id: "123-abc",
	name: "test-worker",
	pid: 42,
	cwd: "/tmp",
	model: "claude-sonnet-4-6",
	startedAt: Date.now() - 60_000,
	heartbeat: Date.now() - 5_000,
	status: "running",
});

beforeEach(() => {
	vi.clearAllMocks();
	mockExistsSync.mockReturnValue(true);
	mockIsPidAlive.mockReturnValue(true);
});

describe("findAgentByName", () => {
	it("returns null when registry dir doesn't exist", () => {
		mockExistsSync.mockReturnValue(false);
		expect(findAgentByName("test-worker")).toBeNull();
	});

	it("returns null when no matching agent", () => {
		mockReaddirSync.mockReturnValue(["other.json"]);
		mockReadFileSync.mockReturnValue(JSON.stringify({ name: "other", pid: 1 }));
		expect(findAgentByName("test-worker")).toBeNull();
	});

	it("finds an agent by name (case-insensitive)", () => {
		mockReaddirSync.mockReturnValue(["123-abc.json"]);
		mockReadFileSync.mockReturnValue(AGENT_JSON);
		const info = findAgentByName("Test-Worker");
		expect(info).not.toBeNull();
		expect(info?.name).toBe("test-worker");
		expect(info?.id).toBe("123-abc");
		expect(info?.alive).toBe(true);
	});

	it("reports alive=false when PID is dead", () => {
		mockReaddirSync.mockReturnValue(["123-abc.json"]);
		mockReadFileSync.mockReturnValue(AGENT_JSON);
		mockIsPidAlive.mockReturnValue(false);
		const info = findAgentByName("test-worker");
		expect(info?.alive).toBe(false);
		expect(info?.status).toBe("terminated");
	});

	it("includes heartbeatAge", () => {
		mockReaddirSync.mockReturnValue(["123-abc.json"]);
		mockReadFileSync.mockReturnValue(AGENT_JSON);
		const info = findAgentByName("test-worker");
		expect(info?.heartbeatAge).toBeGreaterThanOrEqual(0);
		expect(info?.heartbeatAge).toBeLessThan(60_000);
	});
});

describe("sendAgentMessage", () => {
	it("returns true on successful send", async () => {
		// The maildir transport is mocked via node:fs mocks
		const result = await sendAgentMessage("123-abc", "kanban", "hello");
		expect(result).toBe(true);
	});
});

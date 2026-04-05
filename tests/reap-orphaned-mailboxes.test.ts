/**
 * Tests for reapOrphanedMailboxes (lib/agent-registry.ts)
 *
 * Mocks node:fs and process.kill — no real filesystem or processes touched.
 */

import {
	beforeEach,
	describe,
	expect,
	it,
	type MockedFunction,
	vi,
} from "vitest";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	rmSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

import * as nodefs from "node:fs";
import { reapOrphanedMailboxes } from "../lib/agent-registry.js";

const mockReaddirSync = nodefs.readdirSync as MockedFunction<typeof nodefs.readdirSync>;
const mockRmSync = nodefs.rmSync as MockedFunction<typeof nodefs.rmSync>;
const mockUnlinkSync = nodefs.unlinkSync as MockedFunction<typeof nodefs.unlinkSync>;

// Mock process.kill to control which PIDs appear alive
const origKill = process.kill;
let alivePids: Set<number>;

beforeEach(() => {
	vi.resetAllMocks();
	(nodefs.existsSync as MockedFunction<typeof nodefs.existsSync>).mockReturnValue(true);
	alivePids = new Set();

	// Override process.kill signal-0 check
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

describe("reapOrphanedMailboxes", () => {
	it("returns 0 when directory is empty", () => {
		mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof nodefs.readdirSync>);
		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(0);
	});

	it("removes directories with dead PIDs and no .json file", () => {
		mockReaddirSync.mockReturnValue([
			"12345-abc123",
			"12346-def456",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(2);
		expect(mockRmSync).toHaveBeenCalledTimes(2);
	});

	it("skips directories whose PID is alive", () => {
		alivePids.add(12345);
		mockReaddirSync.mockReturnValue([
			"12345-abc123",
			"12346-def456",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(1); // only 12346
	});

	it("skips directories that have a matching .json registry file", () => {
		mockReaddirSync.mockReturnValue([
			"12345-abc123",
			"12345-abc123.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		// The dir has a .json → will be reaped by normal readAllPeers, skip here
		expect(result.removed).toBe(0);
		expect(mockRmSync).not.toHaveBeenCalled();
	});

	it("removes .sock files with dead PIDs", () => {
		mockReaddirSync.mockReturnValue([
			"12345-abc123.sock",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(1);
		expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
		expect(mockUnlinkSync).toHaveBeenCalledWith(
			expect.stringContaining("12345-abc123.sock"),
		);
	});

	it("skips .sock files whose PID is alive", () => {
		alivePids.add(12345);
		mockReaddirSync.mockReturnValue([
			"12345-abc123.sock",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(0);
	});

	it("skips .json files (handled elsewhere)", () => {
		mockReaddirSync.mockReturnValue([
			"12345-abc123.json",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(0);
		expect(mockRmSync).not.toHaveBeenCalled();
		expect(mockUnlinkSync).not.toHaveBeenCalled();
	});

	it("skips entries that don't match the PID-session format", () => {
		mockReaddirSync.mockReturnValue([
			".DS_Store",
			"no-dash",
			"-leading-dash",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(0);
	});

	it("handles mixed live/dead/orphaned entries correctly", () => {
		alivePids.add(100);
		mockReaddirSync.mockReturnValue([
			"100-session1",          // alive PID → keep
			"100-session1.json",     // .json → skip (handled by readAllPeers)
			"100-oldsession",        // alive PID → keep
			"200-session2",          // dead + has .json → skip (readAllPeers handles)
			"200-session2.json",     // .json → skip
			"200-oldsession",        // dead + no .json → REMOVE
			"300-session3",          // dead + no .json → REMOVE
			"300-session3.sock",     // dead .sock → REMOVE
		] as unknown as ReturnType<typeof nodefs.readdirSync>);

		const result = reapOrphanedMailboxes();
		expect(result.removed).toBe(3);
	});

	it("is best-effort — doesn't throw on rmSync failure", () => {
		mockReaddirSync.mockReturnValue([
			"12345-abc123",
		] as unknown as ReturnType<typeof nodefs.readdirSync>);
		mockRmSync.mockImplementation(() => { throw new Error("EPERM"); });

		expect(() => reapOrphanedMailboxes()).not.toThrow();
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendLogLine } from "../../lib/file-persistence.js";
import {
	logAppend,
	selfAppendedLines,
} from "../../extensions/pi-kanban/board-transactions.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

vi.mock("../../lib/file-persistence.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/file-persistence.js")>();
	return { ...actual, appendLogLine: vi.fn(actual.appendLogLine) };
});

setupTempKanbanDir("kanban-watcher-order-test-");
const appendLogLineMock = vi.mocked(appendLogLine);

describe("Kanban watcher self-detection", () => {
	beforeEach(() => {
		selfAppendedLines.clear();
		appendLogLineMock.mockReset();
	});

	it("registers a self-appended line before the filesystem append", async () => {
		const line = "2026-01-01T00:00:00.000Z NOTE T-001 worker text=ordered";
		appendLogLineMock.mockImplementation(async () => {
			expect(selfAppendedLines.has(line)).toBe(true);
		});

		await logAppend(line);
		expect(appendLogLineMock).toHaveBeenCalledOnce();
	});

	it("removes a newly registered line when append fails", async () => {
		const line = "2026-01-01T00:00:00.000Z NOTE T-001 worker text=failed";
		appendLogLineMock.mockRejectedValue(new Error("append failed"));

		await expect(logAppend(line)).rejects.toThrow("append failed");
		expect(selfAppendedLines.has(line)).toBe(false);
	});
});

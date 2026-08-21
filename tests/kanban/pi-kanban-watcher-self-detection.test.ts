import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../../lib/event-log.js";
import {
	logAppend,
	selfAppendedLines,
} from "../../extensions/pi-kanban/board-transactions.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

setupTempKanbanDir("kanban-watcher-order-test-");
const appendEventMock = vi.spyOn(EventLog.prototype, "appendLocked");

describe("Kanban watcher self-detection", () => {
	beforeEach(() => {
		selfAppendedLines.clear();
		appendEventMock.mockReset();
	});

	it("registers a self-appended line before the filesystem append", async () => {
		const line = "2026-01-01T00:00:00.000Z NOTE T-001 worker text=ordered";
		appendEventMock.mockImplementation(async () => {
			expect(selfAppendedLines.has(line)).toBe(true);
		});

		await logAppend(line);
		expect(appendEventMock).toHaveBeenCalledOnce();
	});

	it("removes a newly registered line when append fails", async () => {
		const line = "2026-01-01T00:00:00.000Z NOTE T-001 worker text=failed";
		appendEventMock.mockRejectedValue(new Error("append failed"));

		await expect(logAppend(line)).rejects.toThrow("append failed");
		expect(selfAppendedLines.has(line)).toBe(false);
	});
});

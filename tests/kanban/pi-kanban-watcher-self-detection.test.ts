import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../../lib/event-log.js";
import {
	kanbanEventCodec,
	type KanbanEvent,
} from "../../extensions/pi-kanban/board-events.js";
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
		const event: KanbanEvent = {
			v: 1,
			ts: "2026-01-01T00:00:00.000Z",
			type: "note",
			task_id: "T-001",
			agent: "worker",
			text: "ordered",
		};
		const line = kanbanEventCodec.encode(event);
		appendEventMock.mockImplementation(async () => {
			expect(selfAppendedLines.has(line)).toBe(true);
		});

		await logAppend(event);
		expect(appendEventMock).toHaveBeenCalledOnce();
	});

	it("removes a newly registered line when append fails", async () => {
		const event: KanbanEvent = {
			v: 1,
			ts: "2026-01-01T00:00:00.000Z",
			type: "note",
			task_id: "T-001",
			agent: "worker",
			text: "failed",
		};
		const line = kanbanEventCodec.encode(event);
		appendEventMock.mockRejectedValue(new Error("append failed"));

		await expect(logAppend(event)).rejects.toThrow("append failed");
		expect(selfAppendedLines.has(line)).toBe(false);
	});
});

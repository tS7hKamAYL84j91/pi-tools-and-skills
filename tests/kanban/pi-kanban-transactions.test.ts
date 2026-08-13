import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import {
	logAppend,
	withBoardLock,
} from "../../extensions/pi-kanban/board-transactions.js";
import { runManualCompaction } from "../../extensions/pi-kanban/compaction.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = (): void => {};
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("Kanban board transactions", () => {
	it("serializes concurrent picks so the loser cannot clear the winner", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-070",
			agent: "lead",
			title: "Contended task",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-070",
			agent: "lead",
			to: "todo",
		});

		const results = await Promise.all([
			callTool(harness.tools, "kanban_claim", { agent: "worker-one" }),
			callTool(harness.tools, "kanban_claim", { agent: "worker-two" }),
		]);
		expect(results.map((result) => result.details.result).sort()).toEqual([
			"CLAIMED",
			"NO_TASK_AVAILABLE",
		]);

		const winner = results.find(
			(result) => result.details.result === "CLAIMED",
		)?.details.agent;
		const task = (await parseBoard()).tasks.get("T-070");
		expect(task).toMatchObject({ claimed: true, claimAgent: winner });
		const log = harness.readBoardLog();
		expect(log.match(/ CLAIM T-070 /g)).toHaveLength(1);
		expect(log).not.toContain("UNCLAIM T-070");
	});

	it("holds the board lock across compaction and preserves a waiting append", async () => {
		harness.writeBoardLog(
			'2026-01-01T00:00:00.000Z CREATE T-071 lead title="Keep me" priority="high" tags=""\n',
		);
		const lockAcquired = deferred();
		const releaseLock = deferred();
		const heldLock = withBoardLock(async () => {
			lockAcquired.resolve();
			await releaseLock.promise;
		});
		await lockAcquired.promise;

		let compacted = false;
		let appended = false;
		const compaction = runManualCompaction().then((result) => {
			compacted = true;
			return result;
		});
		const append = logAppend(
			'2026-01-02T00:00:00.000Z NOTE T-071 worker text="survives"',
		).then(() => {
			appended = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(compacted).toBe(false);
		expect(appended).toBe(false);
		await expect(access(join(harness.tmpDir, "archive"))).rejects.toThrow();

		releaseLock.resolve();
		await heldLock;
		await Promise.all([compaction, append]);

		const task = (await parseBoard()).tasks.get("T-071");
		expect(task?.notes).toContain(
			"2026-01-02T00:00:00.000Z [worker] survives",
		);
		expect(harness.readBoardLog().match(/NOTE T-071 worker/g)).toHaveLength(1);
	});
});

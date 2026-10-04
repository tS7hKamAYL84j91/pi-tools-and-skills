import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendRunHistory, loadRunHistory } from "../../extensions/pi-automations/scheduler-run-state.js";
import { shouldRunForSchedule } from "../../extensions/pi-automations/scheduler-quota.js";
import type { ScheduleEntry } from "../../extensions/pi-automations/types.js";

describe("schedule history transactions", () => {
	it("retains concurrent outcomes, bounds history, and enforces resulting quota", async () => {
		const automationsHome = await mkdtemp(join(tmpdir(), "history-concurrency-"));
		const config = { automationsHome };
		try {
			const append = (index: number) => appendRunHistory(config, "daily", { runId: `run-${index}`, startedAt: new Date().toISOString(), outcome: "queued" });
			await Promise.all([append(0), append(1)]);
			expect((await loadRunHistory(config, "daily"))?.entries.map(e => e.runId).sort()).toEqual(["run-0", "run-1"]);
			expect(await shouldRunForSchedule({ config, schedule: { taskId: "daily", runBudget: 2 } as ScheduleEntry, now: new Date() })).toEqual({ shouldRun: false, reason: "budget_exhausted" });
			for (let i = 2; i < 103; i++) await append(i);
			const history = await loadRunHistory(config, "daily");
			expect(history?.entries).toHaveLength(100);
			expect(history?.entries.at(-1)?.runId).toBe("run-102");
			const files = await import("node:fs/promises");
			const names = await files.readdir(join(automationsHome, "schedule-runs"));
			const name = names.find(n => n.endsWith(".history.json"));
			if (!name) throw new Error("missing history");
			expect((await stat(join(automationsHome, "schedule-runs", name))).mode & 0o777).toBe(0o600);
		} finally { await rm(automationsHome, { recursive: true, force: true }); }
	});
});

/** Deterministic ADR-060 slot admission regressions. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduleSlotState } from "../../extensions/pi-coas/scheduler-slot-state.js";
import type { CoasConfig, ScheduleEntry } from "../../extensions/pi-coas/types.js";

const homes: string[] = [];
const schedule: ScheduleEntry = {
	taskId: "task",
	taskName: "Task",
	roomId: "room",
	workspaceId: "workspace",
	cronExpr: "* * * * *",
	enabled: true,
	promptFile: "prompt",
};

async function setup(): Promise<{ config: CoasConfig; state: ReturnType<typeof createScheduleSlotState> }> {
	const home = await mkdtemp(join(tmpdir(), "coas-slot-"));
	homes.push(home);
	await mkdir(join(home, "schedule-runs"));
	const config = { coasHome: home } as CoasConfig;
	return { config, state: createScheduleSlotState(() => config) };
}

afterEach(async () => {
	for (const home of homes.splice(0)) await import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true, force: true }));
});

describe("ADR-060 scheduler slot admission", () => {
	it("allows one token claim and rejects the concurrent loser", async () => {
		const { state } = await setup();
		const [first, second] = await Promise.all([
			state.claim(schedule, "2026-09-05T12:00Z", new Date("2026-09-05T12:00:01Z")),
			state.claim(schedule, "2026-09-05T12:00Z", new Date("2026-09-05T12:00:02Z")),
		]);
		expect([first, second].filter(Boolean)).toHaveLength(1);
	});

	it("uses the exact token for lock-held conditional admission", async () => {
		const { state } = await setup();
		const claim = await state.claim(schedule, "2026-09-05T12:00Z", new Date());
		expect(claim).toBeDefined();
		if (!claim) return;
		expect(await state.admit({ ...claim, token: "stale-token-that-must-not-win" }, new Date())).toBe(false);
		expect(await state.admit(claim, new Date())).toBe(true);
		expect(await state.admit(claim, new Date())).toBe(false);
	});

	it("fails closed on malformed records instead of reclaiming them", async () => {
		const { config, state } = await setup();
		const encoded = Buffer.from("2026-09-05T12:00Z").toString("base64url");
		await writeFile(join(config.coasHome, "schedule-runs", `task.slot-${encoded}.json`), "not-json\n");
		expect(await state.claim(schedule, "2026-09-05T12:00Z", new Date())).toBeUndefined();
	});
});

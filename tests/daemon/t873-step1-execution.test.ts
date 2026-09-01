/**
 * T-873 step-1 execution record (dry-run/claim-check rollout, per the
 * accepted work-order planning/T-873-STEP1-DRY-RUN-WORK-ORDER.md @ 3d74c82).
 * Synthetic fixture state roots only; zero deliveries in every step.
 * Executed 2026-08-28: all 7 steps passed (results in the work-order doc).
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapDaemon, type DaemonBootstrap } from "../../daemon/src/main.js";
import { assertLiveModeAuthorized, readClaim, tickSchedules } from "../../daemon/src/schedule-tick.js";
import { loadSchedules } from "../../daemon/src/cron.js";
import { isDaemonDisabled, markGracefulStop } from "../../daemon/src/breaker.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function fixtureRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "t873-step1-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

async function installSchedules(schedulesDir: string): Promise<void> {
	await mkdir(schedulesDir, { recursive: true });
	const fixtures: Array<[string, string]> = [
		["daily-0900-mon", "0 9 * * 1"],
		["quarter-hourly", "*/15 * * * *"],
		["hourly", "0 * * * *"],
	];
	for (const [taskId, cron] of fixtures) {
		await writeFile(join(schedulesDir, `${taskId}.env`), [
			`TASK_ID=${taskId}`,
			`TASK_NAME=${taskId}`,
			"ROOM_ID=general",
			"WORKSPACE_ID=fixture-a",
			`CRON_EXPR=${cron}`,
			"ENABLED=1",
			"",
		].join("\n"));
		await writeFile(join(schedulesDir, `${taskId}.prompt`), "Fixture work.\n");
	}
}

function tick(roots: DaemonRoots, schedulesDir: string, mode: "dry_run" | "claim_check_only", now: Date, deliveries: string[]) {
	return tickSchedules(
		roots,
		{
			schedulesDir,
			mode,
			guardInputs: { parentId: null, visibility: "workspace", scope: "root" },
			deliver: async (schedule, prompt, claim) => {
				void prompt;
				void claim;
				deliveries.push(schedule.taskId);
			},
		},
		now,
		async () => {},
	);
}

describe("T-873 step 1 execution (dry-run/claim-check rollout)", () => {
	it("runs the 7-step work-order against fixture state roots with zero deliveries", async () => {
		const roots = await fixtureRoots();
		const schedulesDir = join(roots.stateRoot, "schedules");
		const deliveries: string[] = [];
		const results: Record<string, unknown> = {};
		process.env.COAS_DAEMON_MODE = "dry_run";
		let daemon: DaemonBootstrap | undefined;
		try {
			// Step 1: bootstrap in dry_run.
			daemon = await bootstrapDaemon(roots);
			const socketInfo = await stat(daemon.socketPath);
			results.step1 = { started: true, socketMode: socketInfo.mode & 0o777 };
			expect(results.step1).toEqual({ started: true, socketMode: 0o600 });

			// Step 2: install fixture schedules.
			await installSchedules(schedulesDir);
			const schedules = await loadSchedules(schedulesDir, async () => {});
			results.step2 = { loaded: schedules.length };
			expect(schedules).toHaveLength(3);

			// Step 3: one tick at a due minute (Mon 09:00: all three due) — claims only.
			const decisions = await tick(roots, schedulesDir, "dry_run", new Date(2026, 0, 5, 9, 0), deliveries);
			const claimed = decisions.filter((decision) => decision.due).length;
			results.step3 = { claimed, deliveries: deliveries.length, mode: daemon.snapshot().mode };
			expect(claimed).toBe(3);
			expect(deliveries).toEqual([]);

			// Step 4: same-minute repeat — already_claimed (M1 coalescing).
			const repeat = await tick(roots, schedulesDir, "dry_run", new Date(2026, 0, 5, 9, 0, 30), deliveries);
			results.step4 = { alreadyClaimed: repeat.filter((decision) => decision.skippedReason === "already_claimed").length };
			expect(results.step4).toEqual({ alreadyClaimed: 3 });

			// Step 5: claim_check_only rotation on the same state root; claims rotate.
			// The deterministic tick and claim assertions run with no daemon alive:
			// bootstrapDaemon fires a real-clock startup catch-up tick that can claim
		// */15 schedules at a wall-clock minute and race the fixture clock below.
			await daemon.stop();
			process.env.COAS_DAEMON_MODE = "claim_check_only";
			const rotate = await tick(roots, schedulesDir, "claim_check_only", new Date(2026, 0, 5, 9, 15), deliveries);
			const quarterClaim = await readClaim(roots, "quarter-hourly");
			results.step5 = { quarterClaimRotated: quarterClaim?.minuteKey === "2026-01-05T09:15", deliveries: deliveries.length };
			expect(rotate.find((decision) => decision.taskId === "quarter-hourly")?.due).toBe(true);
			expect(quarterClaim?.minuteKey).toBe("2026-01-05T09:15");
			// Bootstrap proves claim_check_only restart works on this state root;
			// its catch-up tick cannot affect any assertion above.
			const daemon2 = await bootstrapDaemon(roots);
			await daemon2.stop();

			// Step 6: rollback rehearsal — graceful stop, lock released, ladder reset.
			await markGracefulStop(roots);
			const lockReleased = await stat(join(roots.runtimeRoot, "daemon.lock")).then(() => false).catch(() => true);
			const disabled = await isDaemonDisabled(roots);
			results.step6 = { lockReleased, daemonDisabled: disabled };
			expect(results.step6).toEqual({ lockReleased: true, daemonDisabled: false });

			// Step 7: live-mode refusal (held closed until the T-870 registry seam).
			let refused = false;
			try {
				assertLiveModeAuthorized("live", false);
			} catch {
				refused = true;
			}
			results.step7 = { liveRefused: refused };
			expect(results.step7).toEqual({ liveRefused: true });

			// Zero deliveries across the whole run.
			expect(deliveries).toEqual([]);
		} finally {
			await rm(roots.runtimeRoot, { recursive: true, force: true }).catch(() => {});
			await rm(roots.stateRoot, { recursive: true, force: true }).catch(() => {});
			delete process.env.COAS_DAEMON_MODE;
			void daemon;
		}
	});
});
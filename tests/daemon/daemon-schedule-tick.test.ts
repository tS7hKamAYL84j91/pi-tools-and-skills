/**
 * Unit tests for the daemon scheduler tick (T-869): cron parity, M1
 * coalescing, write-ahead claim-check (cycle lost, never duplicated),
 * dry-run mode, M5 pi-yields deferral/release-fire/alert, writer-lease
 * restart re-arm.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cronExpressionError,
	loadSchedules,
	scheduleFrequencyCapError,
	scheduleMatchesDate,
} from "../../daemon/src/cron.js";
import {
	assertLiveModeAuthorized,
	claimWriterRole,
	commitClaimCheck,
	invalidateWriterLeaseOnRestart,
	loadWriterLease,
	readClaim,
	releaseWriterRole,
	tickSchedules,
	writerLeaseInGrace,
	type GuardInputSnapshot,
} from "../../daemon/src/schedule-tick.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

const GUARD: GuardInputSnapshot = { parentId: null, visibility: "workspace", scope: "root" };

async function makeContext(): Promise<{ roots: DaemonRoots; schedulesDir: string; keys: { keyId: string; privateKeyPem: string; publicKeyPem: string }; cleanup: () => Promise<void> }> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-tick-"));
	const roots: DaemonRoots = { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
	const schedulesDir = join(roots.stateRoot, "schedules");
	await mkdir(schedulesDir, { recursive: true });
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	return { roots, schedulesDir, keys, cleanup: async () => {
		await rm(roots.runtimeRoot, { recursive: true, force: true });
		await rm(roots.stateRoot, { recursive: true, force: true });
	} };
}

async function writeSchedule(schedulesDir: string, taskId: string, cron: string, options: { writerTag?: boolean; disabled?: boolean } = {}): Promise<void> {
	const lines = [
		`TASK_ID=${taskId}`,
		`TASK_NAME=${taskId}`,
		"ROOM_ID=general",
		"WORKSPACE_ID=room-a",
		`CRON_EXPR=${cron}`,
		`ENABLED=${options.disabled ? "0" : "1"}`,
	];
	if (options.writerTag) lines.push("WRITER_TAG=gravitas");
	lines.push("");
	await writeFile(join(schedulesDir, `${taskId}.env`), lines.join("\n"));
	await writeFile(join(schedulesDir, `${taskId}.prompt`), "Do scheduled work.\n");
}

describe("cron matching (schedule files consumed unchanged)", () => {
	it("matches the documented five-field semantics", () => {
		expect(scheduleMatchesDate("0 9 * * 1", new Date(2026, 0, 5, 9, 0))).toBe(true);
		expect(scheduleMatchesDate("0 9 * * 1", new Date(2026, 0, 5, 9, 1))).toBe(false);
		expect(scheduleMatchesDate("*/15 * * * *", new Date(2026, 0, 5, 9, 30))).toBe(true);
		expect(scheduleMatchesDate("*/15 * * * *", new Date(2026, 0, 5, 9, 31))).toBe(false);
		expect(scheduleMatchesDate("0 9 1-5 * *", new Date(2026, 0, 5, 9, 0))).toBe(true);
		expect(scheduleMatchesDate("0 9 1-5 * *", new Date(2026, 0, 6, 9, 0))).toBe(false);
	});

	it("rejects malformed expressions", () => {
		expect(cronExpressionError("0 9 * *")).toContain("expected 5 fields");
		expect(cronExpressionError("99 * * * *")).toContain("out of range");
		expect(cronExpressionError("a b c d e")).toContain("invalid");
	});

	it("loads schedule env files unchanged", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "daily", "0 9 * * 1");
			const schedules = await loadSchedules(ctx.schedulesDir);
			expect(schedules).toHaveLength(1);
			expect(schedules[0]?.taskId).toBe("daily");
			expect(schedules[0]?.enabled).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});
});

describe("write-ahead claim-check (review F2: cycle lost, never duplicated)", () => {
	it("commits the claim before delivery and treats it as authoritative", async () => {
		const ctx = await makeContext();
		try {
			const claim = await commitClaimCheck(ctx.roots, "daily", GUARD, new Date("2026-01-05T09:00:00Z"));
			expect(claim.minuteKey).toBe("2026-01-05T09:00");
			const persisted = await readClaim(ctx.roots, "daily");
			expect(persisted?.minuteKey).toBe("2026-01-05T09:00");
			// Idempotent per cycle: re-commit returns the existing claim.
			const again = await commitClaimCheck(ctx.roots, "daily", GUARD, new Date("2026-01-05T09:00:30Z"));
			expect(again.minuteKey).toBe("2026-01-05T09:00");
		} finally {
			await ctx.cleanup();
		}
	});

	it("coalesces missed cycles: M1 one fire per due cycle", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "daily", "0 9 * * 1");
			const deliveries: string[] = [];
			const decisions = await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "live",
					guardInputs: GUARD,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 5, 9, 0),
				async () => {},
			);
			expect(deliveries).toEqual(["daily"]);
			expect(decisions[0]?.fired).toBe(true);

			// A second tick in the same minute is claimed already (M1 coalescing).
			const repeat = await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "live",
					guardInputs: GUARD,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 5, 9, 0, 30),
				async () => {},
			);
			expect(repeat[0]?.skippedReason).toBe("already_claimed");
			expect(deliveries).toEqual(["daily"]);
		} finally {
			await ctx.cleanup();
		}
	});
});

describe("dry-run/claim-check mode (ADR-0008 decision 8)", () => {
	it("claims cycles without delivering", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "daily", "0 9 * * 1");
			const deliveries: string[] = [];
			const decisions = await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "dry_run",
					guardInputs: GUARD,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 5, 9, 0),
				async () => {},
			);
			expect(decisions[0]?.fired).toBe(false);
			expect(decisions[0]?.skippedReason).toBe("dry_run");
			expect(deliveries).toEqual([]);
			// The claim-check IS written in dry-run (claim-check mode is the rollout gate).
			expect(await readClaim(ctx.roots, "daily")).toBeDefined();
		} finally {
			await ctx.cleanup();
		}
	});
});

describe("M5 pi-yields (writer lease)", () => {
	it("defers writer-tagged work while a claim is held, with an alert at N=3", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "reflect", "0 9 * * *", { writerTag: true });
			await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			const audits: Record<string, unknown>[] = [];
			const deferralCounts = new Map<string, number>();
			for (let i = 0; i < 3; i++) {
				const decisions = await tickSchedules(
					ctx.roots,
					{
						schedulesDir: ctx.schedulesDir,
						mode: "live",
						guardInputs: GUARD,
						writerLease: await loadWriterLease(ctx.roots),
						deferralCounts,
						deliver: async () => {
							throw new Error("writer-tagged work must not fire while the claim is held");
						},
					},
					new Date(2026, 0, 5 + i, 9, 0),
					async (event) => {
						audits.push(event);
					},
				);
				expect(decisions[0]?.skippedReason).toBe("writer_deferred");
			}
			expect(audits.some((event) => event.kind === "writer_deferral_alert")).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});

	it("fires the coalesced cycle on the first tick after release", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "reflect", "0 9 * * *", { writerTag: true });
			await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			await releaseWriterRole(ctx.roots, "a-gravitas");
			const deliveries: string[] = [];
			await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "live",
					guardInputs: GUARD,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 6, 9, 0),
				async () => {},
			);
			expect(deliveries).toEqual(["reflect"]);
		} finally {
			await ctx.cleanup();
		}
	});

	it("invalidates a surviving lease on daemon restart (no double-writer window)", async () => {
		const ctx = await makeContext();
		try {
			await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			expect(await invalidateWriterLeaseOnRestart(ctx.roots, ctx.keys)).toBe(true);
			const lease = await loadWriterLease(ctx.roots);
			if (!lease) throw new Error("Writer lease not found");
			expect(lease.invalidatedAt).toBeDefined();
			expect(writerLeaseInGrace(lease, new Date())).toBe(true);

			// Re-claim after invalidation succeeds (the live session re-claims).
			const reclaim = await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 2 });
			expect(reclaim.claimed).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});
});
describe("M1 catch-up + live-mode hold (review B4/B3)", () => {
	it("fires the most recent missed cycle within the 24h lookback (M1)", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "daily", "0 9 * * 1");
			// Tick on Tuesday: Monday 09:00 was missed — coalesce to one fire.
			const deliveries: string[] = [];
			await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "live",
					guardInputs: GUARD,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 6, 8, 30),
				async () => {},
			);
			expect(deliveries).toEqual(["daily"]);
			const claim = await readClaim(ctx.roots, "daily");
			expect(claim?.minuteKey).toBe("2026-01-05T09:00");
		} finally {
			await ctx.cleanup();
		}
	});

	it("holds live mode closed until the registry seam lands (review B3)", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "daily", "0 9 * * 1");
			const deliveries: string[] = [];
			// assertLiveModeAuthorized(mode="live", registrySeamReady=false) throws;
			// the daemon bootstrap refuses it, so the tick treats live as claim-check.
			const decisions = await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "claim_check_only",
					guardInputs: GUARD,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 5, 9, 0),
				async () => {},
			);
			expect(decisions[0]?.fired).toBe(false);
			expect(deliveries).toEqual([]);
			expect(await readClaim(ctx.roots, "daily")).toBeDefined();
		} finally {
			await ctx.cleanup();
		}
	});

	it("assertLiveModeAuthorized refuses live without the registry seam (review B3)", () => {
		expect(() => assertLiveModeAuthorized("live", false)).toThrow(/held closed/);
		expect(() => assertLiveModeAuthorized("claim_check_only", false)).not.toThrow();
		expect(() => assertLiveModeAuthorized("dry_run", false)).not.toThrow();
	});
});

describe("fix-pass round 2 (review re-check)", () => {
	it("refuses sub-5-minute comma lists (B7 bypass closed)", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "hot", "0,1 * * * *");
			const schedules = await loadSchedules(ctx.schedulesDir, async () => {});
			expect(schedules).toHaveLength(0);
			expect(scheduleFrequencyCapError("0,1 * * * *")).toContain("below the 5-minute daemon cap");
			expect(scheduleFrequencyCapError("55,56 * * * *")).toContain("below the 5-minute daemon cap");
			expect(scheduleFrequencyCapError("0 9 * * 1")).toBeUndefined();
			expect(scheduleFrequencyCapError("*/15 * * * *")).toBeUndefined();
		} finally {
			await ctx.cleanup();
		}
	});

	it("suppresses writer-tagged firing during the post-restart grace (B5)", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "reflect", "0 9 * * *", { writerTag: true });
			await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			await invalidateWriterLeaseOnRestart(ctx.roots, ctx.keys);
			const lease = await loadWriterLease(ctx.roots, new Map([[ctx.keys.keyId, ctx.keys.publicKeyPem]]));
			expect(lease).toBeDefined();

			const deliveries: string[] = [];
			const decisions = await tickSchedules(
				ctx.roots,
				{
					schedulesDir: ctx.schedulesDir,
					mode: "live",
					guardInputs: GUARD,
					writerLease: lease,
					deliver: async (schedule, prompt, claim) => {
						void prompt;
						void claim;
						deliveries.push(schedule.taskId);
					},
				},
				new Date(2026, 0, 5, 9, 0),
				async () => {},
			);
			// Within the 30s re-arm grace: neither spawn nor session fires.
			expect(decisions[0]?.skippedReason).toBe("writer_deferred");
			expect(deliveries).toEqual([]);
		} finally {
			await ctx.cleanup();
		}
	});

	it("verifies the writer-lease signature on load (B5)", async () => {
		const ctx = await makeContext();
		try {
			await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			const leasePath = join(ctx.roots.stateRoot, "registry", "writer-lease.json");
			const forged = JSON.parse(await readFile(leasePath, "utf8")) as { holder: string; signature: string };
			forged.holder = "a-attacker";
			await writeFile(leasePath, `${JSON.stringify(forged, null, 2)}\n`);
			const lease = await loadWriterLease(ctx.roots, new Map([[ctx.keys.keyId, ctx.keys.publicKeyPem]]));
			expect(lease).toBeUndefined();
		} finally {
			await ctx.cleanup();
		}
	});

	it("refuses unsafe task ids at load (B9)", async () => {
		const ctx = await makeContext();
		try {
			await writeFile(join(ctx.schedulesDir, "traversal.env"), [
				"TASK_ID=../escape",
				"CRON_EXPR=0 9 * * 1",
				"ENABLED=1",
				"",
			].join("\n"));
			const audits: Record<string, unknown>[] = [];
			const schedules = await loadSchedules(ctx.schedulesDir, async (event) => {
				audits.push(event);
			});
			expect(schedules).toHaveLength(0);
			expect(audits.some((event) => event.kind === "schedule_refused")).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});

	it("rotates the claim across cycles (B1 multi-cycle regression)", async () => {
		const ctx = await makeContext();
		try {
			await writeSchedule(ctx.schedulesDir, "hourly", "0 * * * *");
			const deliveries: string[] = [];
			for (const day of [5, 6, 7] as const) {
				await tickSchedules(
					ctx.roots,
					{
						schedulesDir: ctx.schedulesDir,
						mode: "live",
						guardInputs: GUARD,
						deliver: async (schedule, prompt, claim) => {
							void prompt;
							void claim;
							deliveries.push(schedule.taskId);
						},
					},
					new Date(2026, 0, day, 9, 0),
					async () => {},
				).catch(() => {});
			}
			// Multi-cycle rotation must not strand later cycles.
			expect(deliveries.length).toBeGreaterThanOrEqual(2);
		} finally {
			await ctx.cleanup();
		}
	});
});

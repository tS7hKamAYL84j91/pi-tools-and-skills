/**
 * Unit tests for the daemon scheduler tick (T-869): cron parity, M1
 * coalescing, write-ahead claim-check (cycle lost, never duplicated),
 * dry-run mode, M5 pi-yields deferral/release-fire/alert, writer-lease
 * restart re-arm.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cronExpressionError,
	loadSchedules,
	scheduleMatchesDate,
} from "../../daemon/src/cron.js";
import {
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
		"ENABLED=" + (options.disabled ? "0" : "1"),
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
				{ schedulesDir: ctx.schedulesDir, mode: "live", guardInputs: GUARD },
				new Date(2026, 0, 5, 9, 0),
				async (schedule) => {
					deliveries.push(schedule.taskId);
				},
				async () => {},
			);
			expect(deliveries).toEqual(["daily"]);
			expect(decisions[0]?.fired).toBe(true);

			// A second tick in the same minute is claimed already (M1 coalescing).
			const repeat = await tickSchedules(
				ctx.roots,
				{ schedulesDir: ctx.schedulesDir, mode: "live", guardInputs: GUARD },
				new Date(2026, 0, 5, 9, 0, 30),
				async (schedule) => {
					deliveries.push(schedule.taskId);
				},
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
				{ schedulesDir: ctx.schedulesDir, mode: "dry_run", guardInputs: GUARD },
				new Date(2026, 0, 5, 9, 0),
				async (schedule) => {
					deliveries.push(schedule.taskId);
				},
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
					{ schedulesDir: ctx.schedulesDir, mode: "live", guardInputs: GUARD, writerLease: await loadWriterLease(ctx.roots), deferralCounts },
					new Date(2026, 0, 5 + i, 9, 0),
					async () => {
						throw new Error("writer-tagged work must not fire while the claim is held");
					},
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
				{ schedulesDir: ctx.schedulesDir, mode: "live", guardInputs: GUARD },
				new Date(2026, 0, 6, 9, 0),
				async (schedule) => {
					deliveries.push(schedule.taskId);
				},
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
			expect(await invalidateWriterLeaseOnRestart(ctx.roots)).toBe(true);
			const lease = await loadWriterLease(ctx.roots);
			expect(lease?.invalidatedAt).toBeDefined();
			expect(writerLeaseInGrace(lease!, new Date())).toBe(true);

			// Re-claim after invalidation succeeds (the live session re-claims).
			const reclaim = await claimWriterRole(ctx.roots, ctx.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 2 });
			expect(reclaim.claimed).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});
});
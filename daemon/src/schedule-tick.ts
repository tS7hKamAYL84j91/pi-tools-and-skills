/**
 * Daemon scheduler tick (design doc section 5, ADR-0008 delivery seam).
 *
 * Absorbs the CoAS scheduler tick with the ADR-0008 guard inherited by
 * construction: every daemon-ticked delivery traverses the same authenticated
 * envelope + guard path as A2A messages (delivery-seam rule). At-most-once
 * per cycle via the write-ahead claim-check: schedule-state (minuteKey +
 * guard-input snapshot) is committed BEFORE the delivery envelope, and
 * recovery treats schedule-state as authoritative — a crash between claim and
 * enqueue loses the cycle, never duplicates it. M1: missed cycles coalesce to
 * one fire. Dry-run/claim-check mode is the ADR-0008 decision 8 rollout gate.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureValidatedDir, fsyncDir, writeDurableFileNoReplace, writeDurableFileReplace } from "./durable-fs.js";
import { loadSchedules, scheduleMatchesDate, type ScheduleEntry } from "./cron.js";
import { appendAudit } from "./audit.js";
import type { DaemonRoots } from "./paths.js";
import type { AuditSink } from "./keys.js";

export interface GuardInputSnapshot {
	/** parent_agent_id of the target binding (null for root admissions). */
	readonly parentId: string | null;
	/** Registry visibility tag migrated from Panopticon spawn metadata. */
	readonly visibility: string;
	/** Admission scope stamped at admission: root sessions are deliverable. */
	readonly scope: "root" | "task" | "workspace";
}

export interface ScheduleClaim {
	readonly taskId: string;
	readonly minuteKey: string;
	readonly firedAt: string;
	readonly guardInputs: GuardInputSnapshot;
}

export type TickMode = "dry_run" | "claim_check_only" | "live";

export interface TickDecision {
	readonly taskId: string;
	readonly due: boolean;
	readonly fired: boolean;
	readonly skippedReason?: "disabled" | "invalid_cron" | "already_claimed" | "writer_deferred" | "guard_dropped" | "dry_run";
	readonly deferredWriter?: boolean;
}

export interface WriterLease {
	readonly role: "gravitas-writer";
	readonly holder: string;
	readonly holderInstance: string;
	readonly generation: number;
	readonly claimedAt: string;
	/** Set when the lease was invalidated by a daemon restart and awaits re-claim. */
	readonly invalidatedAt?: string;
	readonly signature: string;
}

const M5_DEFERRAL_ALERT_THRESHOLD = 3;

export function minuteKey(date: Date): string {
	return date.toISOString().slice(0, 16);
}

function scheduleStatePath(roots: DaemonRoots, taskId: string): string {
	return join(roots.stateRoot, "schedule-state", `${taskId}.json`);
}

function writerLeasePath(roots: DaemonRoots): string {
	return join(roots.stateRoot, "registry", "writer-lease.json");
}

/** Read the durable writer lease, if any. */
export async function loadWriterLease(roots: DaemonRoots): Promise<WriterLease | undefined> {
	const { readFile } = await import("node:fs/promises");
	try {
		return JSON.parse(await readFile(writerLeasePath(roots), "utf8")) as WriterLease;
	} catch {
		return undefined;
	}
}

/**
 * Writer-role claim (M5): first-wins CAS at admission; durable + signed so a
 * daemon restart invalidates (re-arm) rather than silently dropping the claim.
 */
export async function claimWriterRole(
	roots: DaemonRoots,
	keys: { keyId: string; privateKeyPem: string },
	holder: { agentId: string; instanceId: string; generation: number },
): Promise<{ claimed: boolean; lease?: WriterLease }> {
	const existing = await loadWriterLease(roots);
	if (existing && existing.invalidatedAt === undefined) return { claimed: false, lease: existing };
	const unsigned = {
		role: "gravitas-writer" as const,
		holder: holder.agentId,
		holderInstance: holder.instanceId,
		generation: holder.generation,
		claimedAt: new Date().toISOString(),
	};
	const signature = signBytesHelper(keys, canonicalWriterBytes(unsigned));
	const lease: WriterLease = { ...unsigned, signature };
	await writeDurableFileReplace(writerLeasePath(roots), `${JSON.stringify(lease, null, 2)}\n`, 0o600, roots.stateRoot);
	await appendAudit(roots, { kind: "writer_lease_claimed", holder: holder.agentId, generation: holder.generation }, { durable: true });
	return { claimed: true, lease };
}

function canonicalWriterBytes(unsigned: Omit<WriterLease, "signature">): Uint8Array {
	return Buffer.from(JSON.stringify(unsigned), "utf8");
}

function signBytesHelper(keys: { privateKeyPem: string }, bytes: Uint8Array): string {
	const { createPrivateKey, sign } = require("node:crypto") as typeof import("node:crypto");
	return sign(null, bytes, createPrivateKey(keys.privateKeyPem)).toString("base64");
}

/** Release the writer lease (session disconnect / graceful drain). */
export async function releaseWriterRole(roots: DaemonRoots, holderAgentId: string): Promise<boolean> {
	const existing = await loadWriterLease(roots);
	if (!existing || existing.holder !== holderAgentId) return false;
	const { unlink } = await import("node:fs/promises");
	await unlink(writerLeasePath(roots)).catch(() => {});
	await fsyncDir(join(roots.stateRoot, "registry"));
	await appendAudit(roots, { kind: "writer_lease_released", holder: holderAgentId }, { durable: true });
	return true;
}

/**
 * Writer-lease recovery on daemon restart (formal F1): a surviving claim is
 * invalidated (re-arm) — the live session re-claims on reconnect; until then
 * writer-tagged cycles neither fire into a fresh spawn nor run in the session
 * (bounded 30s grace), closing the double-writer window.
 */
export async function invalidateWriterLeaseOnRestart(roots: DaemonRoots): Promise<boolean> {
	const existing = await loadWriterLease(roots);
	if (!existing || existing.invalidatedAt !== undefined) return false;
	const invalidated: WriterLease = { ...existing, invalidatedAt: new Date().toISOString() };
	await writeDurableFileReplace(writerLeasePath(roots), `${JSON.stringify(invalidated, null, 2)}\n`, 0o600, roots.stateRoot);
	await appendAudit(roots, { kind: "writer_lease_invalidated", holder: existing.holder }, { durable: true });
	return true;
}

/** True when the invalidated lease is still inside the 30s re-arm grace. */
export function writerLeaseInGrace(lease: WriterLease, now: Date): boolean {
	if (lease.invalidatedAt === undefined) return false;
	return now.getTime() - Date.parse(lease.invalidatedAt) < 30_000;
}

/** Write-ahead claim-check: committed BEFORE the delivery envelope (review F2). */
export async function commitClaimCheck(
	roots: DaemonRoots,
	taskId: string,
	guardInputs: GuardInputSnapshot,
	now: Date,
): Promise<ScheduleClaim> {
	const claim: ScheduleClaim = {
		taskId,
		minuteKey: minuteKey(now),
		firedAt: now.toISOString(),
		guardInputs,
	};
	const existing = await readClaim(roots, taskId);
	if (existing?.minuteKey === claim.minuteKey) return existing;
	await ensureValidatedDir(join(roots.stateRoot, "schedule-state"), roots.stateRoot);
	await writeDurableFileNoReplace(scheduleStatePath(roots, taskId), `${JSON.stringify(claim, null, 2)}\n`, 0o600, roots.stateRoot);
	return claim;
}

export async function readClaim(roots: DaemonRoots, taskId: string): Promise<ScheduleClaim | undefined> {
	const { readFile } = await import("node:fs/promises");
	try {
		return JSON.parse(await readFile(scheduleStatePath(roots, taskId), "utf8")) as ScheduleClaim;
	} catch {
		return undefined;
	}
}

export interface TickInput {
	/** The workspace CoAS home's schedules directory (files consumed unchanged). */
	readonly schedulesDir: string;
	readonly mode: TickMode;
	/** Guard inputs for the delivering binding (design doc section 5a). */
	readonly guardInputs: GuardInputSnapshot;
	/** Writer lease state for M5 pi-yields (undefined = no claim held). */
	readonly writerLease?: WriterLease;
	/** Consecutive-deferral counters per task (M5 alert threshold N=3). */
	readonly deferralCounts?: Map<string, number>;
}

/**
 * One scheduler tick: M1-coalesced (each missed cycle fires at most once),
 * write-ahead claim-checked, M5 pi-yields aware. Delivery dispatch is a
 * callback so the dry-run/claim-check rollout modes never deliver.
 */
export async function tickSchedules(
	roots: DaemonRoots,
	input: TickInput,
	now: Date,
	deliver: (schedule: ScheduleEntry, prompt: string, claim: ScheduleClaim) => Promise<void>,
	audit: AuditSink,
): Promise<TickDecision[]> {
	const schedules = await loadSchedules(input.schedulesDir);
	const decisions: TickDecision[] = [];
	const writerLease = input.writerLease;
	const writerClaimHeld = writerLease !== undefined && writerLease.invalidatedAt === undefined;

	for (const schedule of schedules) {
		if (!schedule.enabled) {
			decisions.push({ taskId: schedule.taskId, due: false, fired: false, skippedReason: "disabled" });
			continue;
		}
		if (!scheduleMatchesDate(schedule.cronExpr, now)) {
			continue;
		}
		const existing = await readClaim(roots, schedule.taskId);
		if (existing?.minuteKey === minuteKey(now)) {
			decisions.push({ taskId: schedule.taskId, due: true, fired: false, skippedReason: "already_claimed" });
			continue;
		}

		// M5 pi-yields: writer-tagged work defers while a live claim exists,
		// coalescing to one fire on the first tick after release.
		if (schedule.writerTag === "gravitas" && writerClaimHeld) {
			const counts = input.deferralCounts ?? new Map<string, number>();
			const consecutive = (counts.get(schedule.taskId) ?? 0) + 1;
			counts.set(schedule.taskId, consecutive);
			if (consecutive >= M5_DEFERRAL_ALERT_THRESHOLD) {
				await audit({ kind: "writer_deferral_alert", taskId: schedule.taskId, consecutive });
			}
			decisions.push({ taskId: schedule.taskId, due: true, fired: false, skippedReason: "writer_deferred", deferredWriter: true });
			continue;
		}

		// Write-ahead claim-check BEFORE any delivery (review F2): the cycle is
		// claimed durably first; a crash after the claim loses the cycle.
		const claim = await commitClaimCheck(roots, schedule.taskId, input.guardInputs, now);

		if (input.mode === "live") {
			const prompt = await import("./cron.js").then((m) => m.loadSchedulePrompt(input.schedulesDir, schedule.taskId));
			await deliver(schedule, prompt ?? schedule.taskName, claim);
		}
		await audit({
			kind: input.mode === "live" ? "schedule_fired" : "schedule_claimed_dry_run",
			taskId: schedule.taskId,
			minuteKey: claim.minuteKey,
			mode: input.mode,
			claimId: randomUUID(),
		});
		decisions.push({
			taskId: schedule.taskId,
			due: true,
			fired: input.mode === "live",
			...(input.mode !== "live" ? { skippedReason: "dry_run" as const } : {}),
		});
	}
	return decisions;
}
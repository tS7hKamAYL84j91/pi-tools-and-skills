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
import { join } from "node:path";
import { ensureValidatedDir, fsyncDir, writeDurableFileNoReplace, writeDurableFileReplace } from "./durable-fs.js";
import { loadSchedules, loadSchedulePrompt, scheduleMatchesDate, type ScheduleEntry } from "./cron.js";
import { appendAudit } from "./audit.js";
import type { DaemonRoots } from "./paths.js";
import { signBytes, type AuditSink } from "./keys.js";

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

/**
 * Live mode is held CLOSED until the T-870 registry seam provides
 * registry-derived guard inputs (reviewer B3 alternative): bootstrap refuses
 * it fail-closed, and the tick treats it as claim-check-only.
 */
export function assertLiveModeAuthorized(mode: TickMode, registrySeamReady: boolean): void {
	if (mode === "live" && !registrySeamReady) {
		throw new Error("live mode is held closed until the registry seam (T-870) provides registry-derived guard inputs");
	}
}

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
	readonly keyId: string;
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

/** Read the writer lease; the signature is verified when keys are provided. */
export async function loadWriterLease(roots: DaemonRoots, verificationKeys?: ReadonlyMap<string, string>): Promise<WriterLease | undefined> {
	const { readFile } = await import("node:fs/promises");
	let parsed: WriterLease;
	try {
		parsed = JSON.parse(await readFile(writerLeasePath(roots), "utf8")) as WriterLease;
	} catch {
		return undefined;
	}
	if (verificationKeys) {
		const key = verificationKeys.get(parsed.keyId ?? "");
		const { signature, ...unsigned } = parsed;
		if (!key) return undefined;
		const ok = await import("./keys.js").then((m) => m.verifyBytes(key, canonicalWriterBytes(unsigned), Buffer.from(signature, "base64")));
		if (!ok) return undefined;
	}
	return parsed;
}

/** Holder-liveness expiry: a claim dies 30s after its binding (design doc section 6). */
export function writerLeaseExpired(lease: WriterLease, now: Date, holderAlive: (agentId: string) => boolean): boolean {
	void now;
	return !holderAlive(lease.holder);
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
		keyId: keys.keyId,
		claimedAt: new Date().toISOString(),
	};
	const signature = signBytes(keys.privateKeyPem, canonicalWriterBytes(unsigned)).toString("base64");
	const lease: WriterLease = { ...unsigned, signature };
	await writeDurableFileReplace(writerLeasePath(roots), `${JSON.stringify(lease, null, 2)}\n`, 0o600, roots.stateRoot);
	await appendAudit(roots, { kind: "writer_lease_claimed", holder: holder.agentId, generation: holder.generation }, { durable: true });
	return { claimed: true, lease };
}

function canonicalWriterBytes(unsigned: Omit<WriterLease, "signature">): Uint8Array {
	return Buffer.from(JSON.stringify(unsigned), "utf8");
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
export async function invalidateWriterLeaseOnRestart(
	roots: DaemonRoots,
	keys: { keyId: string; privateKeyPem: string },
): Promise<boolean> {
	const existing = await loadWriterLease(roots);
	if (!existing || existing.invalidatedAt !== undefined) return false;
	// The invalidated record must be re-signed: signature verification on load
	// would otherwise reject it (review B5).
	const unsigned = {
		role: existing.role,
		holder: existing.holder,
		holderInstance: existing.holderInstance,
		generation: existing.generation,
		keyId: existing.keyId,
		claimedAt: existing.claimedAt,
		invalidatedAt: new Date().toISOString(),
	};
	const signature = signBytes(keys.privateKeyPem, canonicalWriterBytes(unsigned)).toString("base64");
	const invalidated: WriterLease = { ...unsigned, signature };
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
	minuteKeyOverride?: string,
): Promise<ScheduleClaim> {
	const claim: ScheduleClaim = {
		taskId,
		minuteKey: minuteKeyOverride ?? minuteKey(now),
		firedAt: now.toISOString(),
		guardInputs,
	};
	const existing = await readClaim(roots, taskId);
	if (existing?.minuteKey === claim.minuteKey) return existing;
	// Rotation: a NEW cycle replaces the previous claim (monotonic by
	// minuteKey); no-replace semantics only guard within a single cycle
	// (review B1 — the claim must not strand future cycles).
	await ensureValidatedDir(join(roots.stateRoot, "schedule-state"), roots.stateRoot);
	if (existing === undefined) {
		await writeDurableFileNoReplace(scheduleStatePath(roots, taskId), `${JSON.stringify(claim, null, 2)}\n`, 0o600, roots.stateRoot);
	} else {
		await writeDurableFileReplace(scheduleStatePath(roots, taskId), `${JSON.stringify(claim, null, 2)}\n`, 0o600, roots.stateRoot);
	}
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
	/** Holder liveness for M5 expiry (serve loop bindingFor). */
	readonly holderAlive?: (agentId: string) => boolean;
	/** Delivery: enqueue a real signed envelope (delivery-seam rule). */
	readonly deliver: (schedule: ScheduleEntry, prompt: string, claim: ScheduleClaim) => Promise<void>;
	/** Verification keys for writer-lease signature checks. */
	readonly verificationKeys?: ReadonlyMap<string, string>;
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
	audit: AuditSink,
): Promise<TickDecision[]> {
	const schedules = await loadSchedules(input.schedulesDir, audit);
	const decisions: TickDecision[] = [];
	const writerLease = input.writerLease;
	// M5 suppression applies while a live claim is held AND during the 30s
	// post-restart re-arm grace (review B5 — the grace was inverted). A claim
	// whose holder binding is gone expires 30s after the binding died.
	const writerClaimHeld =
		writerLease !== undefined &&
		(writerLeaseInGrace(writerLease, now) ||
			(writerLease.invalidatedAt === undefined &&
				(input.holderAlive === undefined || input.holderAlive(writerLease.holder))));

	for (const schedule of schedules) {
		if (!schedule.enabled) {
			decisions.push({ taskId: schedule.taskId, due: false, fired: false, skippedReason: "disabled" });
			continue;
		}
		// M1 coalesced catch-up: the current minute, else the most recent
		// missed cycle within the 24h lookback (one fire per missed window).
		const dueMinute = dueMinuteFor(schedule.cronExpr, now);
		if (dueMinute === undefined) continue;
		const existing = await readClaim(roots, schedule.taskId);
		if (existing?.minuteKey === dueMinute) {
			decisions.push({ taskId: schedule.taskId, due: true, fired: false, skippedReason: "already_claimed" });
			continue;
		}

		// M5 pi-yields: writer-tagged work defers while a claim is held (or in
		// re-arm grace), coalescing to one fire on the first tick after release.
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
		const claim = await commitClaimCheck(roots, schedule.taskId, input.guardInputs, now, dueMinute);

		if (input.mode === "live") {
			const prompt = await loadSchedulePrompt(input.schedulesDir, schedule.taskId);
			await input.deliver(schedule, prompt ?? schedule.taskName, claim);
		} else if (input.mode === "claim_check_only") {
			// claim_check_only: claim committed, no delivery, no dry-run audit.
			decisions.push({ taskId: schedule.taskId, due: true, fired: false, skippedReason: "dry_run" });
			continue;
		}
		await audit({
			kind: input.mode === "live" ? "schedule_fired" : "schedule_claimed_dry_run",
			taskId: schedule.taskId,
			minuteKey: claim.minuteKey,
			mode: input.mode,
			posture: "same_uid_untrusted",
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

const CATCHUP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * M1 coalesced catch-up (review B4): the current minute, or the most recent
 * missed cycle within the 24h lookback (in-pi parity, one fire).
 */
export function dueMinuteFor(cronExpr: string, now: Date): string | undefined {
	if (scheduleMatchesDate(cronExpr, now)) return minuteKey(now);
	const endMinute = Math.floor(now.getTime() / 60_000) * 60_000;
	const startMs = endMinute - CATCHUP_LOOKBACK_MS;
	for (let t = endMinute - 60_000; t >= startMs; t -= 60_000) {
		const candidate = new Date(t);
		if (scheduleMatchesDate(cronExpr, candidate)) return minuteKey(candidate);
	}
	return undefined;
}
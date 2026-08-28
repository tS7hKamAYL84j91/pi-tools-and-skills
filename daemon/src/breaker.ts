/**
 * Failure-threshold breaker (ADR-0018 rollback: "repeated unrecoverable
 * daemon crashes (three or more within 24h, or any state-corruption event)
 * auto-disable the daemon for the affected workspace, revert scheduling to
 * the in-pi model, and raise an alert" — no silent restart-loop).
 *
 * Durable crash counter in the state root: a start without a prior graceful
 * stop increments the count; a graceful stop resets it. The threshold writes
 * a daemon-disabled flag that makes bootstrap refuse fail-closed until the
 * Principal/Quartermaster clears it explicitly.
 */
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { appendAudit } from "./audit.js";
import { fsyncDir, writeDurableFileReplace } from "./durable-fs.js";
import type { DaemonRoots } from "./paths.js";

export const CRASH_THRESHOLD = 3;
export const CRASH_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface CrashCounter {
	/** UTC timestamps of the unclean starts inside the window. */
	readonly crashes: readonly string[];
}

function crashCounterPath(roots: DaemonRoots): string {
	return join(roots.stateRoot, "daemon-crashes.json");
}

export function daemonDisabledPath(roots: DaemonRoots): string {
	return join(roots.stateRoot, "daemon-disabled.json");
}

/** Read the disabled flag; present means bootstrap must refuse. */
export async function isDaemonDisabled(roots: DaemonRoots): Promise<boolean> {
	try {
		const raw = await readFile(daemonDisabledPath(roots), "utf8");
		const parsed = JSON.parse(raw) as { readonly disabledAt?: string; readonly reason?: string };
		return typeof parsed.reason === "string";
	} catch {
		return false;
	}
}

/** Quartermaster/Principal clears the breaker explicitly (audit + flag removal). */
export async function clearDaemonDisabled(roots: DaemonRoots, clearedBy: string): Promise<boolean> {
	try {
		await readFile(daemonDisabledPath(roots), "utf8");
	} catch {
		return false;
	}
	await unlink(daemonDisabledPath(roots)).catch(() => {});
	await fsyncDir(roots.stateRoot);
	await appendAudit(roots, { kind: "daemon_disabled_cleared", clearedBy }, { durable: true });
	return true;
}

/**
 * Record a daemon start. An unclean start (no graceful stop since the last
 * start) counts as a crash; crossing the threshold writes the disabled flag
 * and the durable alert.
 */
export async function recordDaemonStart(
	roots: DaemonRoots,
	gracefulStopSeen: boolean,
	now: Date = new Date(),
): Promise<{ crashesInWindow: number; disabled: boolean }> {
	if (gracefulStopSeen) {
		await resetCrashCounter(roots);
		return { crashesInWindow: 0, disabled: false };
	}
	const crashes = await readCrashes(roots, now);
	crashes.push(now.toISOString());
	await writeCrashes(roots, crashes);
	const inWindow = crashes.length;
	if (inWindow >= CRASH_THRESHOLD) {
		await writeDurableFileReplace(
			daemonDisabledPath(roots),
			`${JSON.stringify({ reason: "crash_threshold", crashes: crashes.length, disabledAt: now.toISOString() }, null, 2)}\n`,
			0o600,
			roots.stateRoot,
		);
		await appendAudit(roots, {
			kind: "daemon_disabled",
			reason: "crash_threshold",
			crashesInWindow: inWindow,
			action: "revert to in-pi scheduler; Principal/Quartermaster clears the flag",
		}, { durable: true });
		return { crashesInWindow: inWindow, disabled: true };
	}
	return { crashesInWindow: inWindow, disabled: false };
}

/** Record state corruption: immediate disable + alert (ADR rollback clause). */
export async function recordStateCorruption(roots: DaemonRoots, detail: string, now: Date = new Date()): Promise<void> {
	await writeDurableFileReplace(
		daemonDisabledPath(roots),
		`${JSON.stringify({ reason: "state_corruption", detail, disabledAt: now.toISOString() }, null, 2)}\n`,
		0o600,
		roots.stateRoot,
	);
	await appendAudit(roots, { kind: "daemon_disabled", reason: "state_corruption", detail }, { durable: true });
}

const GRACEFUL_STOP_FLAG = "daemon-graceful-stop.flag";

/** Durable marker written on graceful stop; the next start consumes it. */
export async function markGracefulStop(roots: DaemonRoots): Promise<void> {
	await writeDurableFileReplace(
		join(roots.stateRoot, GRACEFUL_STOP_FLAG),
		`${JSON.stringify({ at: new Date().toISOString() }, null, 2)}\n`,
		0o600,
		roots.stateRoot,
	);
}

/** True when a graceful stop happened since the last start; consumed on read. */
export async function gracefulStopSeenSinceLastStart(roots: DaemonRoots): Promise<boolean> {
	try {
		await readFile(join(roots.stateRoot, GRACEFUL_STOP_FLAG), "utf8");
		await unlink(join(roots.stateRoot, GRACEFUL_STOP_FLAG)).catch(() => {});
		return true;
	} catch {
		return false;
	}
}

/** Graceful stop resets the crash ladder. */
export async function resetCrashCounter(roots: DaemonRoots): Promise<void> {
	await writeDurableFileReplace(crashCounterPath(roots), `${JSON.stringify({ crashes: [] }, null, 2)}\n`, 0o600, roots.stateRoot);
}

async function readCrashes(roots: DaemonRoots, now: Date): Promise<string[]> {
	try {
		const parsed = JSON.parse(await readFile(crashCounterPath(roots), "utf8")) as { crashes?: unknown };
		if (!Array.isArray(parsed.crashes)) return [];
		const cutoff = now.getTime() - CRASH_WINDOW_MS;
		return parsed.crashes.filter((stamp): stamp is string => {
			if (typeof stamp !== "string") return false;
			const at = Date.parse(stamp);
			return !Number.isNaN(at) && at > cutoff;
		});
	} catch {
		return [];
	}
}

async function writeCrashes(roots: DaemonRoots, crashes: readonly string[]): Promise<void> {
	await writeDurableFileReplace(crashCounterPath(roots), `${JSON.stringify({ crashes }, null, 2)}\n`, 0o600, roots.stateRoot);
}
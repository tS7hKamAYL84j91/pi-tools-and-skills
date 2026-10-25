/**
 * Durable namespace-ownership journal.
 *
 * Stable lifecycle/ownership metadata for declared lead agents: when an agent
 * registers under its project's declared panopticon name (trusted launch
 * metadata, never an LLM-chosen label), the claim is journalled here and
 * persists across restarts. A supporting agent may then never claim a
 * reserved lead label — "a prefix is not authority" holds even when the lead
 * process is temporarily dead, so a renamed helper cannot squat a lead's name
 * and intercept messages addressed to it.
 *
 * Invariants:
 * - Written only programmatically by the declaring agent's own lifecycle
 *   (register + throttled heartbeat refresh). No manual registry edits.
 * - One fixed filename in REGISTRY_DIR; namespace labels are never used raw
 *   in filesystem paths and are charset-validated on both read and write.
 * - Ownership rights: an entry's ownerId (self re-claim) or the project's own
 *   declared name (restart takeover). Reserved entries do not expire; stale
 *   entries for renamed leads merely keep an old label unclaimable, which is
 *   safe and intended.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withAdvisoryLock } from "../../../lib/file-lock.js";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import { REGISTRY_DIR } from "../../../lib/agent-registry.js";

const JOURNAL_VERSION = 1;
const SAFE_OWNER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SAFE_REGISTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface NamespaceOwnerEntry {
	/** Declared canonical lead name (the namespace anchor label). */
	name: string;
	/** Registry id of the declaring agent process at claim time. */
	ownerId: string;
	/** Project working directory of the declaring agent. */
	cwd: string;
	createdAt: number;
	lastSeenAt: number;
}

interface JournalFileShape {
	version: number;
	owners: NamespaceOwnerEntry[];
}

/** Fixed journal filename — never derived from any namespace label. */
export const NAMESPACE_OWNERS_FILE = "namespace-owners.json";

/** Fixed journal path in the registry dir — never derived from any namespace label. */
export function ownershipJournalPath(): string {
	return join(REGISTRY_DIR, NAMESPACE_OWNERS_FILE);
}

function isValidEntry(value: unknown): value is NamespaceOwnerEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.name === "string" &&
		SAFE_OWNER_NAME.test(entry.name) &&
		typeof entry.ownerId === "string" &&
		SAFE_REGISTRY_ID.test(entry.ownerId) &&
		typeof entry.cwd === "string" &&
		entry.cwd.length > 0 &&
		typeof entry.createdAt === "number" &&
		Number.isFinite(entry.createdAt) &&
		typeof entry.lastSeenAt === "number" &&
		Number.isFinite(entry.lastSeenAt)
	);
}

/**
 * Synchronously load the journal for claim checks. Malformed files and
 * invalid entries are ignored (treated as absent) — a hand-corrupted journal
 * must never wedge name claiming; the next declared write replaces it.
 */
export function loadNamespaceOwners(): NamespaceOwnerEntry[] {
	try {
		const raw = JSON.parse(
			readFileSync(ownershipJournalPath(), "utf8"),
		) as unknown;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			return [];
		}
		const owners = (raw as Partial<JournalFileShape>).owners;
		if (!Array.isArray(owners)) return [];
		return owners.filter(isValidEntry);
	} catch {
		return [];
	}
}

/** Lower-cased reserved labels this claimer must not take. */
export function reservedNamesFor(options: {
	selfId: string;
	/** Own declared project name — restart takeover right (trusted metadata). */
	takeoverName?: string;
}): string[] {
	const takeover = options.takeoverName?.trim().toLowerCase();
	return loadNamespaceOwners()
		.filter(
			(entry) =>
				entry.ownerId !== options.selfId &&
				entry.name.toLowerCase() !== takeover,
		)
		.map((entry) => entry.name.toLowerCase());
}

/** True when `name` is reserved for a different owner and may not be claimed. */
export function isReservedName(
	name: string,
	reserved: readonly string[],
): boolean {
	return reserved.includes(name.trim().toLowerCase());
}

/**
 * Merge-write one declared ownership entry (last writer wins per label,
 * case-insensitive). Advisory-locked read-modify-write so concurrent declared
 * registrations cannot drop each other's entries.
 */
export async function recordDeclaredOwnership(
	entry: NamespaceOwnerEntry,
): Promise<void> {
	if (!isValidEntry(entry)) return;
	const path = ownershipJournalPath();
	await withAdvisoryLock(path, async () => {
		const existing = loadNamespaceOwners();
		const merged = existing
			.filter((candidate) => candidate.name.toLowerCase() !== entry.name.toLowerCase())
			.concat(entry)
			.sort((a, b) => a.name.localeCompare(b.name));
		const journal: JournalFileShape = { version: JOURNAL_VERSION, owners: merged };
		await writeFileAtomic(path, `${JSON.stringify(journal, null, 2)}\n`, {
			mode: 0o600,
		});
	});
}
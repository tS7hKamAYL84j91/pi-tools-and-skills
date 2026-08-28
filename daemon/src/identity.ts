/**
 * Durable identity records (ADR-0018 section 2): stable opaque `agent_id`,
 * immutable `agent_instance_id` per admitted incarnation, monotonically
 * increasing `generation` per agent_id. Identity records are signed with the
 * daemon integrity key (ADR section 8) and follow the design doc section 3
 * fsync ordering: the generation-N record is durable before any
 * generation-N envelope is enqueued or the binding is published.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	writeDurableFileNoReplace,
	writeDurableFileReplace,
} from "./durable-fs.js";
import { identitiesDir } from "./paths.js";
import { assertSafeId, type DaemonRoots } from "./paths.js";
import { signBytes, verifyBytes } from "./keys.js";
import { readRecordStrict } from "./record.js";

/** ADR-0008 (7) spawn scope tag, stamped by the daemon at admission. */
export type AdmissionScope = "root" | "task" | "workspace";

export interface IdentityRecord {
	readonly agentId: string;
	/** Display alias only; never identity (ADR section 5). */
	readonly displayName: string;
	/** Current generation for this agent_id; monotonic. */
	readonly generation: number;
	/** Immutable id of the currently admitted incarnation, when one is live. */
	readonly liveInstanceId?: string;
	/** ADR-0008 guard inputs, daemon-owned after first admission (design doc section 5a). */
	readonly parentId?: string | null;
	readonly visibility?: string;
	readonly scope?: AdmissionScope;
	readonly createdAt: string;
	readonly updatedAt: string;
	/** Ed25519 signature (base64) over the canonical unsigned bytes. */
	readonly signature: string;
	readonly keyId: string;
}

export interface IdentityKeys {
	readonly keyId: string;
	readonly privateKeyPem: string;
}

/** Unsigned view in fixed field order; signing bytes are reproducible. */
interface UnsignedIdentity {
	readonly agentId: string;
	readonly displayName: string;
	readonly generation: number;
	readonly liveInstanceId?: string;
	readonly parentId?: string | null;
	readonly visibility?: string;
	readonly scope?: AdmissionScope;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly keyId: string;
}

function canonicalIdentityBytes(unsigned: UnsignedIdentity): Uint8Array {
	return Buffer.from(JSON.stringify(unsigned), "utf8");
}

export function mintAgentId(): string {
	return `a-${randomUUID()}`;
}

export function mintInstanceId(): string {
	return `i-${randomUUID()}`;
}

/**
 * Unsigned view of a record with selected fields overridden; keeps the
 * ADR-0008 guard inputs stable across generation bumps and invalidations.
 */
function unsignedFrom(
	record: IdentityRecord,
	overrides: Partial<UnsignedIdentity>,
): UnsignedIdentity {
	return {
		agentId: record.agentId,
		displayName: record.displayName,
		generation: record.generation,
		liveInstanceId: record.liveInstanceId,
		parentId: record.parentId,
		visibility: record.visibility,
		scope: record.scope,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		keyId: record.keyId,
		...overrides,
	};
}

function identityPath(roots: DaemonRoots, agentId: string): string {
	// Path components are validated opaque ids (ADR section 6): daemon-minted
	// ids pass; any user-derived name is rejected here.
	assertSafeId("agent id", agentId);
	return join(identitiesDir(roots), `${agentId}.json`);
}

/** Create a new identity record at generation 1. No-replace: an existing id fails. */
export async function createIdentity(
	roots: DaemonRoots,
	keys: IdentityKeys,
	input: {
		readonly displayName: string;
		readonly parentId?: string | null;
		readonly visibility?: string;
		readonly scope?: AdmissionScope;
	},
): Promise<IdentityRecord> {
	const now = new Date().toISOString();
	const unsigned: UnsignedIdentity = {
		agentId: mintAgentId(),
		displayName: input.displayName,
		generation: 1,
		parentId: input.parentId,
		visibility: input.visibility,
		scope: input.scope,
		createdAt: now,
		updatedAt: now,
		keyId: keys.keyId,
	};
	const signature = signBytes(
		keys.privateKeyPem,
		canonicalIdentityBytes(unsigned),
	).toString("base64");
	const record: IdentityRecord = { ...unsigned, signature };
	await writeDurableFileNoReplace(
		identityPath(roots, record.agentId),
		`${JSON.stringify(record, null, 2)}\n`,
		0o600,
		roots.stateRoot,
	);
	return record;
}

/** Load and verify an identity record; tampered records are errors, never trusted. */
export async function loadIdentity(
	roots: DaemonRoots,
	agentId: string,
	verificationKeys: ReadonlyMap<string, string>,
): Promise<IdentityRecord | undefined> {
	const parsed = await readRecordStrict(
		roots,
		identityPath(roots, agentId),
		(value: unknown): IdentityRecord | undefined => {
			if (typeof value !== "object" || value === null) return undefined;
			const record = value as Record<string, unknown>;
			if (
				typeof record.agentId !== "string" ||
				typeof record.displayName !== "string" ||
				typeof record.generation !== "number" ||
				typeof record.signature !== "string" ||
				typeof record.keyId !== "string" ||
				typeof record.createdAt !== "string" ||
				typeof record.updatedAt !== "string"
			) {
				return undefined;
			}
			if (
				!(
					record.parentId === undefined ||
					record.parentId === null ||
					typeof record.parentId === "string"
				) ||
				!(
					record.visibility === undefined ||
					typeof record.visibility === "string"
				) ||
				!(
					record.scope === undefined ||
					record.scope === "root" ||
					record.scope === "task" ||
					record.scope === "workspace"
				)
			) {
				return undefined;
			}
			// SAFETY: the validator above narrowed every field, including the optional
			// guard inputs; no runtime-invisible invariant remains unchecked.
			return value as unknown as IdentityRecord;
		},
	);
	if (!parsed) return undefined;
	const verificationKey = verificationKeys.get(parsed.keyId);
	if (!verificationKey)
		throw new Error(`unknown identity key: ${parsed.keyId}`);
	const { signature, ...unsigned } = parsed;
	if (
		!verifyBytes(
			verificationKey,
			canonicalIdentityBytes(unsigned),
			Buffer.from(signature, "base64"),
		)
	) {
		throw new Error(`identity record signature invalid: ${agentId}`);
	}
	return parsed;
}

/** Bump generation and attach a new live instance; durable before any binding publish. */
export async function admitNewInstance(
	roots: DaemonRoots,
	keys: IdentityKeys,
	existing: IdentityRecord,
): Promise<{ record: IdentityRecord; instanceId: string }> {
	const instanceId = mintInstanceId();
	const unsigned = unsignedFrom(existing, {
		generation: existing.generation + 1,
		liveInstanceId: instanceId,
		updatedAt: new Date().toISOString(),
	});
	const signature = signBytes(
		keys.privateKeyPem,
		canonicalIdentityBytes(unsigned),
	).toString("base64");
	const record: IdentityRecord = { ...unsigned, signature };
	await writeDurableFileReplace(
		identityPath(roots, existing.agentId),
		`${JSON.stringify(record, null, 2)}\n`,
		0o600,
		roots.stateRoot,
	);
	return { record, instanceId };
}

/**
 * Clear a stale live-instance binding (restart recovery, ADR section 2/7):
 * generation is unchanged so continuity holds; the next admission bumps it.
 */
export async function invalidateLiveInstance(
	roots: DaemonRoots,
	keys: IdentityKeys,
	existing: IdentityRecord,
): Promise<IdentityRecord> {
	const unsigned = unsignedFrom(existing, {
		liveInstanceId: undefined,
		updatedAt: new Date().toISOString(),
	});
	const signature = signBytes(
		keys.privateKeyPem,
		canonicalIdentityBytes(unsigned),
	).toString("base64");
	const record: IdentityRecord = { ...unsigned, signature };
	await writeDurableFileReplace(
		identityPath(roots, record.agentId),
		`${JSON.stringify(record, null, 2)}\n`,
		0o600,
		roots.stateRoot,
	);
	return record;
}

export { verifyBytes };

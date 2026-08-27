/**
 * Daemon integrity key management (design doc section 9, ADR Guardrails).
 *
 * Private Ed25519 integrity key lives in the OS keyring via secret-tool when
 * available. The 0600-file fallback is a recorded temporary deviation valid
 * ONLY while the same_uid_untrusted posture holds; it emits an audit event and
 * is forbidden once authenticated mode ships.
 */
import { spawn } from "node:child_process";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { publicKeysDir } from "./paths.js";
import { writeDurableFileNoReplace, writeDurableFileReplace } from "./durable-fs.js";
import type { DaemonRoots } from "./paths.js";

export const POSTURE = "same_uid_untrusted";

export interface DaemonKeys {
	readonly keyId: string;
	readonly privateKeyPem: string;
	readonly publicKeyPem: string;
	/** True when the private key is persisted only in the fallback file. */
	readonly fallbackFileUsed: boolean;
}

export type AuditSink = (event: Record<string, unknown>) => Promise<void>;

function runSecretTool(args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
		});
		child.on("error", () => resolve(undefined));
		child.on("close", (code) => {
			resolve(code === 0 ? out : undefined);
		});
		child.stdin.end();
	});
}

const KEYRING_SCHEMA = "coas-daemon";

function fallbackKeyPath(roots: DaemonRoots): string {
	return join(roots.stateRoot, "keys", "integrity.key");
}

export function publicKeysPath(roots: DaemonRoots, keyId: string): string {
	return join(publicKeysDir(roots), `${keyId}.pub`);
}

/**
 * Load or create the daemon integrity key. Emits audit events for the
 * fallback. The keyId is stable for this daemon state root; rotation retains
 * prior verification keys (public halves are never removed while signed
 * queued messages remain live).
 */
export async function loadOrCreateIntegrityKey(roots: DaemonRoots, audit: AuditSink): Promise<DaemonKeys> {
	const keyId = "coas-daemon-integrity-1";

	const fromKeyring = await runSecretTool(["lookup", "schema", KEYRING_SCHEMA, "id", keyId]);
	if (fromKeyring?.includes("PRIVATE KEY")) {
		const publicKeyPem = await loadOrPublishPublicKey(roots, keyId, fromKeyring, audit);
		return { keyId, privateKeyPem: fromKeyring, publicKeyPem, fallbackFileUsed: false };
	}

	// Fallback: 0600 file under the state root. Recorded deviation (section 9):
	// valid only in same_uid_untrusted; audit event required; forbidden once
	// authenticated mode ships.
	let pem: string | undefined;
	try {
		const raw = await readFile(fallbackKeyPath(roots), "utf8");
		if (raw.includes("PRIVATE KEY")) pem = raw;
	} catch {
		pem = undefined;
	}
	if (!pem) {
		const pair = generateKeyPairSync("ed25519");
		pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		await writeDurableFileReplace(fallbackKeyPath(roots), pem);
	}
	await audit({
		kind: "key_fallback_file",
		posture: POSTURE,
		detail: "OS keyring unavailable; integrity key stored as 0600 file (temporary deviation, same_uid_untrusted only)",
	});
	const publicKeyPem = await loadOrPublishPublicKey(roots, keyId, pem, audit);
	return { keyId, privateKeyPem: pem, publicKeyPem, fallbackFileUsed: true };
}

async function loadOrPublishPublicKey(roots: DaemonRoots, keyId: string, privateKeyPem: string, audit: AuditSink): Promise<string> {
	const pubPath = publicKeysPath(roots, keyId);
	try {
		return await readFile(pubPath, "utf8");
	} catch {
		const publicKey = createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
		await writeDurableFileNoReplace(pubPath, publicKey);
		await audit({ kind: "public_key_published", keyId });
		return publicKey;
	}
}

/** Sign canonical bytes with the daemon integrity key (library constant-time primitives). */
export function signBytes(privateKeyPem: string, bytes: Uint8Array): Buffer {
	return cryptoSign(null, bytes, createPrivateKey(privateKeyPem));
}

/** Verify canonical bytes against a retained verification key. */
export function verifyBytes(publicKeyPem: string, bytes: Uint8Array, signature: Buffer): boolean {
	return cryptoVerify(null, bytes, createPublicKey(publicKeyPem), signature);
}
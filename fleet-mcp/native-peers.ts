/** Non-mutating host-native discovery. Never use the reaping registry reader here. */
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/v4";
import { REGISTRY_DIR, STALE_MS, isPidAlive, type AgentRecord } from "../lib/agent-registry.js";
import { assertPrivateFileForRead, auditPrivateDirectory } from "../lib/private-local-mode.js";
import { canSee } from "../extensions/pi-panopticon/registry/visibility.js";

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const nativeRecord = z.object({
	id: idSchema, name: z.string().min(1), kind: z.literal("pi").optional(),
	pid: z.number().int().positive(), cwd: z.string(), model: z.string(),
	startedAt: z.number().finite(), heartbeat: z.number().finite(),
	status: z.enum(["running", "waiting", "done", "blocked", "stalled", "terminated", "unknown"]),
	parentId: idSchema.optional(), visibility: z.enum(["global", "scoped"]).optional(),
});

async function readNativeRecord(file: string): Promise<AgentRecord | undefined> {
	const path = join(REGISTRY_DIR, file);
	try {
		assertPrivateFileForRead(path);
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size > 65_536 || (stat.mode & 0o777) !== 0o600) return undefined;
			const record = nativeRecord.parse(JSON.parse(await handle.readFile("utf8")));
			if (`${record.id}.json` !== file || record.id.startsWith("ext-") || !isPidAlive(record.pid)) return undefined;
			return { ...record, kind: "pi", status: Date.now() - record.heartbeat > STALE_MS ? "stalled" : record.status };
		} finally {
			await handle.close();
		}
	} catch {
		// Corrupt, unsafe and vanished peers are unavailable, never removed or repaired.
		return undefined;
	}
}

/** Missing grant means no native access; invalid/stale grants fail closed. */
export async function visibleNativePeers(referenceId: string | undefined): Promise<AgentRecord[]> {
	if (!referenceId) return [];
	if (!auditPrivateDirectory(REGISTRY_DIR).ok) throw new Error("Native registry unavailable");
	const files = (await readdir(REGISTRY_DIR)).filter((file) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(file));
	const records: AgentRecord[] = [];
	for (const file of files) {
		const record = await readNativeRecord(file);
		if (record) records.push(record);
	}
	const reference = records.find((record) => record.id === referenceId);
	if (!reference || Date.now() - reference.heartbeat > STALE_MS || reference.status === "terminated" || reference.status === "done") throw new Error("Native visibility reference unavailable");
	return records.filter((record) => canSee(reference, record));
}

/** Native delivery must not resurrect a dead peer or create a ghost inbox. */
export function nativeInboxAvailable(record: AgentRecord): boolean {
	if (!isPidAlive(record.pid)) return false;
	return ["", "tmp", "new", "cur"].every((part) => auditPrivateDirectory(join(REGISTRY_DIR, record.id, "inbox", part)).ok);
}

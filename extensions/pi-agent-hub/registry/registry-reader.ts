/**
 * Volatile registry-file reading and lifecycle classification.
 */

import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentRecord } from "../../../lib/agent-registry.js";
import {
	ensureRegistryDir,
	isValidAgentName,
	isPidAlive,
	REGISTRY_DIR,
	runAgentCleanup,
	STALE_MS,
} from "../../../lib/agent-registry.js";
import { ensurePrivateFileForRead } from "../../../lib/private-local-mode.js";
import { auditRegistryRelease } from "./registry-audit.js";
import { NAMESPACE_OWNERS_FILE } from "./namespace-ownership.js";

/** Classify an agent record's lifecycle state. */
export function classifyRecord(
	record: AgentRecord,
	now: number,
	pidAlive: boolean,
): "live" | "stalled" | "dead" {
	// A dead PID is definitive: reap immediately regardless of heartbeat freshness.
	// Only use heartbeat staleness to distinguish active from stalled processes.
	if (!pidAlive) return "dead";
	if (now - record.heartbeat <= STALE_MS) return "live";
	return "stalled";
}

function removeRegistryFile(fullPath: string): void {
	try {
		unlinkSync(fullPath);
	} catch {
		// Already gone.
	}
}

/**
 * Parse and classify one volatile registry record.
 * Dead, corrupt, unreadable, and injected external records are removed.
 */
function parseRegistryFile(fullPath: string, now: number): AgentRecord | null {
	try {
		ensurePrivateFileForRead(fullPath);
		const record: AgentRecord = JSON.parse(readFileSync(fullPath, "utf-8"));
		// External records are trusted only after manifest validation and are
		// merged through setExternalPeers(), never through the volatile registry.
		if (record.kind === "external") {
			removeRegistryFile(fullPath);
			return null;
		}
		// Unsafe or missing names ("/", "#", traversal-shaped, hand-edited) fall
		// back to the cwd basename so no record name can equal another agent's
		// derived qualified or disambiguated display label.
		if (!isValidAgentName(record.name)) {
			record.name = basename(record.cwd) || record.id.slice(0, 8);
		}
		const classification = classifyRecord(record, now, isPidAlive(record.pid));
		if (classification === "dead") {
			auditRegistryRelease(record.id, record.name, `pid_dead:${record.pid}`);
			removeRegistryFile(fullPath);
			runAgentCleanup(record.id);
			return null;
		}
		if (classification === "stalled") record.status = "stalled";
		return record;
	} catch {
		// Corrupt or unreadable records must not remain in the volatile registry.
		removeRegistryFile(fullPath);
		return null;
	}
}

/** Read all live and stalled records from the volatile registry. */
export function readVolatileRegistryRecords(): AgentRecord[] {
	try {
		ensureRegistryDir();
		const now = Date.now();
		// The durable namespace-ownership journal lives in the registry dir but
		// is not a volatile agent record — the reaping sweep must never touch it.
		const files = readdirSync(REGISTRY_DIR).filter(
			(file) =>
				typeof file === "string" &&
				file.endsWith(".json") &&
				file !== NAMESPACE_OWNERS_FILE,
		);
		const records: AgentRecord[] = [];
		for (const file of files) {
			const record = parseRegistryFile(join(REGISTRY_DIR, file), now);
			if (record) records.push(record);
		}
		return records;
	} catch {
		return [];
	}
}

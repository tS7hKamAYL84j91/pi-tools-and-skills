/**
 * Registry sync persistence helpers.
 */

import { join } from "node:path";
import { renameSync } from "node:fs";
import type { AgentRecord } from "../../../lib/agent-registry.js";
import {
	ensureRegistryDir,
	REGISTRY_DIR,
} from "../../../lib/agent-registry.js";
import {
	assertPrivateFileTarget,
	writeNewPrivateFileSync,
} from "../../../lib/private-local-mode.js";
import { isDaemonRegistryEnabled } from "./daemon-registry-source.js";

/**
 * Best-effort atomic flush of a single registry record to disk.
 *
 * M6 handoff (design doc section 7): in daemon mode the daemon registry is
 * the sole authority and panopticon is a read-only consumer, so shared-disk
 * writes are bypassed entirely — no dual-write, ever. The local in-memory
 * record still feeds tool display; the durable record lives in the daemon.
 */
export function flushRecord(record: AgentRecord | undefined): void {
	if (!record) return;
	if (isDaemonRegistryEnabled()) return;
	try {
		ensureRegistryDir();
		const path = join(REGISTRY_DIR, `${record.id}.json`);
		const tmpPath = `${path}.${process.pid}.tmp`;
		assertPrivateFileTarget(tmpPath);
		// Heavily justified: called synchronously on agent shutdown to update status to terminated.
		writeNewPrivateFileSync(tmpPath, JSON.stringify(record, null, 2));
		assertPrivateFileTarget(path);
		renameSync(tmpPath, path);
	} catch {
		// best-effort
	}
}

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

/** Best-effort atomic flush of a single registry record to disk. */
export function flushRecord(record: AgentRecord | undefined): void {
	if (!record) return;
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

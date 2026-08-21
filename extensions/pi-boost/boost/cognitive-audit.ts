/** Private, redacted append-only audit sink for cognitive boost outcomes. */

import { homedir } from "node:os";
import { join } from "node:path";
import { appendLogLine } from "../../../lib/file-persistence.js";
import {
	assertPrivateFileTarget,
	ensurePrivateDirectory,
} from "../../../lib/private-local-mode.js";
import type { CognitiveAuditSink } from "./cognitive-types.js";

export function createCognitiveAuditSink(root = join(homedir(), ".pi", "agent", "boost")): CognitiveAuditSink {
	return {
		async append(record) {
			ensurePrivateDirectory(root);
			const path = join(root, "cognitive-audit.jsonl");
			assertPrivateFileTarget(path);
			await appendLogLine(path, JSON.stringify(record), { mode: 0o600 });
		},
	};
}

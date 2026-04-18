/**
 * Clean up pi mailbox: kill daemon, remove record + inbox.
 */

import { existsSync, readFileSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_DIR } from "../../../../lib/agent-registry.js";

const SESSION_FILE = join(process.cwd(), ".pi", "mailbox-session.json");

if (!existsSync(SESSION_FILE)) {
  process.exit(0);
}

let agentId: string;
let daemonPid: number | undefined;
try {
  const session = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
  agentId = session.agentId;
  daemonPid = session.daemonPid;
} catch {
  process.exit(0);
}

// Kill heartbeat daemon if tracked
if (daemonPid) {
  try { process.kill(daemonPid, "SIGTERM"); } catch { /* already gone */ }
}

// Remove agent record
try { unlinkSync(join(REGISTRY_DIR, `${agentId}.json`)); } catch { /* gone */ }

// Remove inbox directory
try { rmSync(join(REGISTRY_DIR, agentId), { recursive: true, force: true }); } catch { /* gone */ }

// Remove session file
try { unlinkSync(SESSION_FILE); } catch { /* gone */ }

console.log("Mailbox cleaned up.");

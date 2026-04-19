/**
 * Register this Claude Code session as a pi agent with a mailbox.
 * Starts a heartbeat interval and writes session state to .pi/mailbox-session.json.
 *
 * Runs as a long-lived background process (via &) — exits when parent dies.
 * Self-heals: re-creates record + maildir if deleted externally (e.g. by reaper).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { REGISTRY_DIR, STALE_MS, ensureRegistryDir, type AgentRecord } from "../../../../lib/agent-registry.js";
import { createMaildirTransport } from "../../../../lib/transports/maildir.js";

const SESSION_FILE = join(process.cwd(), ".pi", "mailbox-session.json");
const parentPid = Number(process.env["CLAUDE_PID"] ?? process.ppid);

// ── Helpers ────────────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Returns true if SESSION_FILE belongs to the given agent instance. */
function ownsSessionFile(id: string): boolean {
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
    return s.agentId === id;
  } catch { return false; }
}

/** Clean up only files owned by this instance. */
function cleanupOwned(id: string): void {
  try { unlinkSync(join(REGISTRY_DIR, `${id}.json`)); } catch { /* gone */ }
  try { rmSync(join(REGISTRY_DIR, id), { recursive: true, force: true }); } catch { /* gone */ }
  if (ownsSessionFile(id)) {
    try { unlinkSync(SESSION_FILE); } catch { /* gone */ }
  }
}

// ── Guard: already registered? ──────────────────────────────────
// Only bail out if the existing registration is genuinely alive
// (PID responding AND heartbeat fresh). Otherwise clean up and re-register.

if (existsSync(SESSION_FILE)) {
  try {
    const session = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
    const existingPath = join(REGISTRY_DIR, `${session.agentId}.json`);
    if (existsSync(existingPath)) {
      const rec: AgentRecord = JSON.parse(readFileSync(existingPath, "utf-8"));
      const alive = isPidAlive(rec.pid);
      const fresh = (Date.now() - rec.heartbeat) <= STALE_MS;
      if (alive && fresh) {
        console.log(`Already registered as "${rec.name}" (id: ${session.agentId})`);
        process.exit(0);
      }
      // Stale registration — clean up before re-registering
      cleanupOwned(session.agentId);
    } else {
      // Record gone, session file orphaned
      try { unlinkSync(SESSION_FILE); } catch { /* gone */ }
    }
  } catch { /* corrupt — fall through */ }
}

// ── Generate agent ID ───────────────────────────────────────────

const agentId = `${parentPid}-${Date.now().toString(36)}`;

// ── Pick unique name ────────────────────────────────────────────

function pickName(): string {
  ensureRegistryDir();
  const envName = process.env["AGENT_NAME"];
  if (envName) return envName;
  const repo = basename(process.cwd()) || "agent";
  const base = `cc-${repo}`;

  const takenNames = new Set<string>();
  try {
    for (const f of readdirSync(REGISTRY_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const rec: AgentRecord = JSON.parse(readFileSync(join(REGISTRY_DIR, f), "utf-8"));
        if (rec.name) takenNames.add(rec.name.toLowerCase());
      } catch { /* skip */ }
    }
  } catch { /* empty registry */ }

  if (!takenNames.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!takenNames.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${agentId.slice(0, 6)}`;
}

const agentName = pickName();

// ── Create Maildir inbox ────────────────────────────────────────

const transport = createMaildirTransport();
transport.init(agentId);

// ── Write agent record ──────────────────────────────────────────

const startedAt = Date.now();
const recordPath = join(REGISTRY_DIR, `${agentId}.json`);

/** Find the Claude Code session JSONL for the parent PID. */
function findSessionFile(): string | undefined {
  try {
    const metaPath = join(homedir(), ".claude", "sessions", `${parentPid}.json`);
    if (!existsSync(metaPath)) return undefined;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const sessionId = meta.sessionId as string | undefined;
    if (!sessionId) return undefined;
    // Project key is the cwd path with slashes replaced by dashes
    const projectKey = process.cwd().replace(/\//g, "-");
    const candidate = join(homedir(), ".claude", "projects", projectKey, `${sessionId}.jsonl`);
    return existsSync(candidate) ? candidate : undefined;
  } catch { return undefined; }
}

const sessionFile = findSessionFile();

/** (Re-)write the registry record with current heartbeat. */
function writeRecord(heartbeatTime?: number): void {
  const rec: AgentRecord = {
    id: agentId,
    name: agentName,
    pid: parentPid,
    cwd: process.cwd(),
    model: "anthropic/claude-code",
    startedAt,
    heartbeat: heartbeatTime ?? Date.now(),
    status: "waiting",
    pendingMessages: 0,
    sessionFile,
  };
  ensureRegistryDir();
  writeFileSync(recordPath, JSON.stringify(rec, null, 2), "utf-8");
}

writeRecord(startedAt);

// ── Write session state ─────────────────────────────────────────

function writeSessionFile(): void {
  mkdirSync(join(process.cwd(), ".pi"), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify({
    agentId,
    name: agentName,
    parentPid,
    registeredAt: startedAt,
  }, null, 2), "utf-8");
}

writeSessionFile();

console.log(`Registered as "${agentName}" (id: ${agentId})`);
console.log(`Mailbox: ~/.pi/agents/${agentId}/inbox/new/`);
console.log(`Other agents can reach you via: agent_send(name="${agentName}", message="...")`);

// ── Heartbeat loop ──────────────────────────────────────────────
// Keeps running to update heartbeat and clean up on parent exit.
// Self-heals: if registry record was deleted externally, re-creates it.

function heartbeat(): void {
  if (!isPidAlive(parentPid)) {
    cleanupOwned(agentId);
    process.exit(0);
  }

  // Self-heal: re-create record + maildir if deleted externally
  if (!existsSync(recordPath)) {
    writeRecord();
    transport.init(agentId);
    if (!existsSync(SESSION_FILE) || ownsSessionFile(agentId)) {
      writeSessionFile();
    }
    return;
  }

  try {
    const rec: AgentRecord = JSON.parse(readFileSync(recordPath, "utf-8"));
    rec.heartbeat = Date.now();
    writeFileSync(recordPath, JSON.stringify(rec, null, 2), "utf-8");
  } catch {
    // Corrupt — re-create
    writeRecord();
  }
}

setInterval(heartbeat, 5_000);

// ── Inbox watcher ───────────────────────────────────────────────
// Watch inbox/new/ for arriving messages and print them to stdout
// so a Monitor can wake Claude on delivery.

const inboxNewDir = join(REGISTRY_DIR, agentId, "inbox", "new");

function deliverNewMessages(): void {
  const messages = transport.receive(agentId);
  if (messages.length === 0) return;

  console.log(`--- ${messages.length} new message(s) ---`);
  for (const msg of messages) {
    const time = msg.ts
      ? new Date(msg.ts).toLocaleTimeString("en-GB", { hour12: false })
      : "??:??:??";
    console.log("");
    console.log(`From: ${msg.from}  Time: ${time}`);
    console.log(msg.text);
    transport.ack(agentId, msg.id);
  }
  console.log("");
  console.log("--- end messages ---");
  transport.prune(agentId);
}

try {
  watch(inboxNewDir, (_event, filename) => {
    if (filename) deliverNewMessages();
  });
} catch {
  // Fallback: poll in heartbeat if fs.watch fails
}

// ── Signal handlers ─────────────────────────────────────────────

// Survive shell exit
process.on("SIGHUP", () => { /* ignore — stay alive */ });

// Graceful shutdown
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    cleanupOwned(agentId);
    process.exit(0);
  });
}

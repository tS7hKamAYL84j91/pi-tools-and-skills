/**
 * External agent registrar.
 *
 * Manages durable registration of non-pi agents that communicate via
 * persistent Maildir mailboxes outside the volatile registry directory.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import { ensureExternalMailbox, externalMailboxPath } from "../../../lib/transports/external-mailbox.js";
import type { AgentRecord } from "../../../lib/agent-registry.js";
import { getCoasHome } from "../../../lib/coas-home.js";

const EXTERNAL_MANIFEST_VERSION = 1;

interface ExternalRuntimeConfig {
	workspaceRoot?: string;
}

interface ExternalAgentInput {
	readonly name: string;
	readonly mailboxPath?: string;
}

interface ExternalAgentManifestEntry {
	readonly version: number;
	readonly id: string;
	readonly name: string;
	readonly kind: "external";
	readonly mailboxPath: string;
	readonly startedAt: number;
	readonly heartbeat: number;
	readonly status: "waiting";
}

function manifestPath(config: ExternalRuntimeConfig): string {
	const base = config.workspaceRoot ? config.workspaceRoot : getCoasHome();
	return join(base, "external-agents.json");
}

async function loadManifest(config: ExternalRuntimeConfig): Promise<ExternalAgentManifestEntry[]> {
	const path = manifestPath(config);
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isValidManifestEntry);
	} catch {
		return [];
	}
}

function isValidManifestEntry(value: unknown): value is ExternalAgentManifestEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return (
		item.version === EXTERNAL_MANIFEST_VERSION &&
		typeof item.id === "string" &&
		typeof item.name === "string" &&
		item.kind === "external" &&
		typeof item.mailboxPath === "string" &&
		typeof item.startedAt === "number" &&
		typeof item.heartbeat === "number"
	);
}

async function saveManifest(config: ExternalRuntimeConfig, entries: ExternalAgentManifestEntry[]): Promise<void> {
	const path = manifestPath(config);
	await writeFileAtomic(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
}

function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** Register a new external agent and return its AgentRecord. */
export async function registerExternalAgent(
	config: ExternalRuntimeConfig,
	input: ExternalAgentInput,
): Promise<AgentRecord> {
	const name = normalizeName(input.name);
	if (!name) throw new Error("External agent name must be non-empty");

	const existing: ExternalAgentManifestEntry[] = await loadManifest(config);
	if (existing.some((record) => record.name.toLowerCase() === name)) {
		throw new Error(`External agent "${name}" is already registered`);
	}

	const id = `ext-${randomUUID()}`;
	const mailboxPath = input.mailboxPath
		? input.mailboxPath
		: externalMailboxPath(id);
	await ensureExternalMailbox(id, mailboxPath);

	const now = Date.now();
	const entry: ExternalAgentManifestEntry = {
		version: EXTERNAL_MANIFEST_VERSION,
		id,
		name,
		kind: "external",
		mailboxPath,
		startedAt: now,
		heartbeat: now,
		status: "waiting",
	};

	const entries: ExternalAgentManifestEntry[] = [...existing, entry];
	await saveManifest(config, entries);

	return manifestEntryToRecord(entry);
}

/** Remove an external agent by id. */
export async function unregisterExternalAgent(config: ExternalRuntimeConfig, id: string): Promise<void> {
	const entries = (await loadManifest(config)).filter((entry) => entry.id !== id);
	await saveManifest(config, entries);
}

/** Load all registered external agents as AgentRecords. */
export async function loadExternalAgents(config: ExternalRuntimeConfig): Promise<AgentRecord[]> {
	const manifest = await loadManifest(config);
	return manifest.map(manifestEntryToRecord);
}

/** List currently registered external agents. */
export function listExternalAgents(config: ExternalRuntimeConfig): Promise<AgentRecord[]> {
	return loadExternalAgents(config);
}

function manifestEntryToRecord(entry: ExternalAgentManifestEntry): AgentRecord {
	return {
		id: entry.id,
		name: entry.name,
		kind: "external",
		pid: 0,
		cwd: entry.mailboxPath,
		model: "external",
		startedAt: entry.startedAt,
		heartbeat: entry.heartbeat,
		status: entry.status,
		mailboxPath: entry.mailboxPath,
	};
}

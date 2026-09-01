/** Durable registration for non-pi agents with persistent Maildir mailboxes. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentRecord } from "../../../lib/agent-registry.js";
import { withAdvisoryLock } from "../../../lib/file-lock.js";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import { ensurePrivateDirectory } from "../../../lib/private-local-mode.js";
import {
	defaultPersistDir,
	ensureExternalMailbox,
	externalMailboxPath,
} from "./external-mailbox.js";

const EXTERNAL_MANIFEST_VERSION = 1;
const SAFE_EXTERNAL_ID = /^ext-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_EXTERNAL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

interface ExternalRuntimeConfig {
	readonly workspaceRoot: string;
	readonly mailboxRoot?: string;
}

interface ExternalAgentInput {
	readonly name: string;
	/** Final Maildir inbox path, including no implicit id/inbox suffix. */
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

function resolveWorkspaceRoot(config: ExternalRuntimeConfig): string {
	if (!isAbsolute(config.workspaceRoot)) {
		throw new Error("External agent workspace root must be absolute");
	}
	return resolve(config.workspaceRoot);
}

function resolveMailboxRoot(config: ExternalRuntimeConfig): string {
	const root = config.mailboxRoot ?? defaultPersistDir();
	if (!isAbsolute(root)) {
		throw new Error("External agent mailbox root must be absolute");
	}
	return resolve(root);
}

function manifestPath(config: ExternalRuntimeConfig): string {
	return join(resolveWorkspaceRoot(config), "external-agents.json");
}

function confinedMailboxPath(path: string, root: string): string {
	if (!isAbsolute(path)) {
		throw new Error("External agent mailbox path must be absolute");
	}
	const resolvedPath = resolve(path);
	const pathFromRoot = relative(root, resolvedPath);
	if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
		throw new Error(`External agent mailbox path must be inside ${root}`);
	}
	return resolvedPath;
}

async function loadManifest(config: ExternalRuntimeConfig): Promise<ExternalAgentManifestEntry[]> {
	const path = manifestPath(config);
	const mailboxRoot = resolveMailboxRoot(config);
	const raw = await readManifestFile(path);
	if (raw === undefined) {
		return [];
	}
	// A malformed manifest is rejected rather than treated as an empty registry.
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error: unknown) {
		throw error instanceof Error ? error : new Error(String(error));
	}
	if (!Array.isArray(parsed)) {
		throw new Error(`External agent manifest must be an array: ${path}`);
	}
	if (!parsed.every((entry) => isValidManifestEntry(entry, mailboxRoot))) {
		throw new Error(`External agent manifest contains an invalid entry: ${path}`);
	}
	return parsed;
}

async function readManifestFile(path: string): Promise<string | undefined> {
	let pathStat: Awaited<ReturnType<typeof lstat>>;
	try {
		pathStat = await lstat(path);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
	if (pathStat.isSymbolicLink()) {
		throw new Error(`External agent manifest must not be a symlink: ${path}`);
	}
	if (!pathStat.isFile()) {
		throw new Error(`External agent manifest must be a regular file: ${path}`);
	}

	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
	try {
		const fileStat = await file.stat();
		if (!fileStat.isFile()) {
			throw new Error(`External agent manifest must be a regular file: ${path}`);
		}
		if (fileStat.dev !== pathStat.dev || fileStat.ino !== pathStat.ino) {
			throw new Error(`External agent manifest changed during read: ${path}`);
		}
		return await file.readFile("utf8");
	} finally {
		await file.close();
	}
}

function isValidManifestEntry(value: unknown, mailboxRoot: string): value is ExternalAgentManifestEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const item = value as Record<string, unknown>;
	if (
		item.version !== EXTERNAL_MANIFEST_VERSION ||
		typeof item.id !== "string" ||
		!SAFE_EXTERNAL_ID.test(item.id) ||
		typeof item.name !== "string" ||
		!SAFE_EXTERNAL_NAME.test(item.name) ||
		item.kind !== "external" ||
		typeof item.mailboxPath !== "string" ||
		typeof item.startedAt !== "number" ||
		!Number.isFinite(item.startedAt) ||
		typeof item.heartbeat !== "number" ||
		!Number.isFinite(item.heartbeat) ||
		item.status !== "waiting"
	) {
		return false;
	}
	try {
		return confinedMailboxPath(item.mailboxPath, mailboxRoot) === item.mailboxPath;
	} catch {
		return false;
	}
}

async function saveManifest(path: string, entries: ExternalAgentManifestEntry[]): Promise<void> {
	await writeFileAtomic(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
}

function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** Register an external agent after checking all currently visible peer names. */
export async function registerExternalAgent(
	config: ExternalRuntimeConfig,
	input: ExternalAgentInput,
	peers: readonly AgentRecord[] = [],
): Promise<AgentRecord> {
	const name = normalizeName(input.name);
	if (!SAFE_EXTERNAL_NAME.test(name)) {
		throw new Error("External agent name must contain letters, numbers, or hyphens");
	}
	const workspaceRoot = resolveWorkspaceRoot(config);
	const path = manifestPath(config);
	const mailboxRoot = resolveMailboxRoot(config);
	return withAdvisoryLock(path, async () => {
		const existing = await loadManifest(config);
		if ([...peers, ...existing].some((record) => record.name.toLowerCase() === name)) {
			throw new Error(`Agent name "${name}" is already registered`);
		}

		const id = `ext-${randomUUID()}`;
		const mailboxPath = confinedMailboxPath(
			input.mailboxPath ?? externalMailboxPath(id, mailboxRoot),
			mailboxRoot,
		);
		ensurePrivateDirectory(mailboxRoot);
		ensureExternalMailbox(mailboxPath);
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
		await saveManifest(path, [...existing, entry]);
		return manifestEntryToRecord(entry, workspaceRoot);
	});
}

/** Remove registration metadata while retaining durable mailbox contents. */
export async function unregisterExternalAgent(config: ExternalRuntimeConfig, id: string): Promise<void> {
	const path = manifestPath(config);
	await withAdvisoryLock(path, async () => {
		const entries = (await loadManifest(config)).filter((entry) => entry.id !== id);
		await saveManifest(path, entries);
	});
}

/** Load all valid external agents from this workspace's manifest. */
export async function loadExternalAgents(config: ExternalRuntimeConfig): Promise<AgentRecord[]> {
	const workspaceRoot = resolveWorkspaceRoot(config);
	return (await loadManifest(config)).map((entry) => manifestEntryToRecord(entry, workspaceRoot));
}

/** List all valid external agents registered in this workspace. */
export function listExternalAgents(config: ExternalRuntimeConfig): Promise<AgentRecord[]> {
	return loadExternalAgents(config);
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === code
	);
}

function manifestEntryToRecord(entry: ExternalAgentManifestEntry, workspaceRoot: string): AgentRecord {
	return {
		id: entry.id,
		name: entry.name,
		kind: "external",
		pid: 0,
		cwd: workspaceRoot,
		model: "external",
		startedAt: entry.startedAt,
		heartbeat: entry.heartbeat,
		status: entry.status,
		mailboxPath: entry.mailboxPath,
	};
}

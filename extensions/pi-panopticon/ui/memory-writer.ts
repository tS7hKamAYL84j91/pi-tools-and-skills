/** Temp-manifest-gated Panopticon MEMORY.md writer POC. */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { writeFileAtomic } from "../../../lib/file-persistence.js";

const MANIFEST_NAME = "panopticon-memory-manifest.json";
const DEFAULT_MAX_BYTES = 16 * 1024;
const DEFAULT_TERMINAL_RETAIN = 5;
const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

interface PanopticonMemoryWriteInput {
	manifestRoot: string;
	agentId: string;
	content: string;
	terminal?: boolean;
	maxBytes?: number;
	terminalRetain?: number;
}

interface PanopticonMemoryWriteResult {
	memoryPath: string;
	archivePath?: string;
	removedArchives: string[];
}

type PanopticonMemoryReadiness = "ok" | "missing" | "oversized" | "malformed";

interface PanopticonMemoryValidationResult {
	status: PanopticonMemoryReadiness;
	bytes?: number;
	reason?: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function safeAgentId(agentId: string): string {
	const trimmed = agentId.trim();
	if (!SAFE_ID.test(trimmed) || trimmed.includes("..")) {
		throw new Error("agentId must be a safe local id");
	}
	return trimmed;
}

function assertWithin(parent: string, child: string): void {
	const normalizedParent = resolve(parent);
	const normalizedChild = resolve(child);
	if (normalizedChild !== normalizedParent && !normalizedChild.startsWith(`${normalizedParent}${sep}`)) {
		throw new Error("memory path escapes manifest root");
	}
}

async function requireManifestRoot(manifestRoot: string): Promise<string> {
	if (!isAbsolute(manifestRoot)) {
		throw new Error("manifestRoot must be absolute");
	}
	const root = resolve(manifestRoot);
	const manifestPath = join(root, MANIFEST_NAME);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { allowMemoryPoc?: unknown; rootType?: unknown };
	if (manifest.allowMemoryPoc !== true || manifest.rootType !== "temp-panopticon-memory-poc") {
		throw new Error("memory POC manifest is not approved for this root");
	}
	return root;
}

function assertBoundedContent(content: string, maxBytes: number): void {
	if (Buffer.byteLength(content, "utf8") > maxBytes) {
		throw new Error("MEMORY.md content exceeds size cap");
	}
}

async function pruneArchives(archiveDir: string, retain: number): Promise<string[]> {
	if (!(await pathExists(archiveDir))) {
		return [];
	}
	const entries = await readdir(archiveDir, { withFileTypes: true });
	const files = await Promise.all(entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map(async (entry) => {
			const path = join(archiveDir, entry.name);
			const stats = await stat(path);
			return { path, mtimeMs: stats.mtimeMs };
		}));
	const remove = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(Math.max(0, retain));
	for (const file of remove) {
		await rm(file.path, { force: true });
	}
	return remove.map((file) => file.path);
}

/** Write latest advisory MEMORY.md under an explicit temp manifest root. */
export async function writePanopticonMemorySnapshot(input: PanopticonMemoryWriteInput): Promise<PanopticonMemoryWriteResult> {
	const root = await requireManifestRoot(input.manifestRoot);
	const agentId = safeAgentId(input.agentId);
	const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
	assertBoundedContent(input.content, maxBytes);
	const agentDir = join(root, "agents", agentId);
	assertWithin(root, agentDir);
	const memoryPath = join(agentDir, "MEMORY.md");
	await writeFileAtomic(memoryPath, input.content);
	let archivePath: string | undefined;
	let removedArchives: string[] = [];
	if (input.terminal === true) {
		const archiveDir = join(agentDir, "memory", "archive");
		await mkdir(archiveDir, { recursive: true });
		archivePath = join(archiveDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}-${basename(memoryPath)}`);
		await writeFileAtomic(archivePath, input.content);
		removedArchives = await pruneArchives(archiveDir, input.terminalRetain ?? DEFAULT_TERMINAL_RETAIN);
	}
	return { memoryPath, ...(archivePath ? { archivePath } : {}), removedArchives };
}

/** Validate a written MEMORY.md without repairing or deleting corrupt content. */
export async function validatePanopticonMemorySnapshot(path: string, maxBytes = DEFAULT_MAX_BYTES): Promise<PanopticonMemoryValidationResult> {
	try {
		const stats = await stat(path);
		if (stats.size > maxBytes) {
			return { status: "oversized", bytes: stats.size, reason: "snapshot exceeds size cap" };
		}
		const content = await readFile(path, "utf8");
		if (!content.startsWith("---\n") || !content.includes("\n---\n") || !content.includes("# MEMORY.md")) {
			return { status: "malformed", bytes: stats.size, reason: "snapshot front matter or heading is malformed" };
		}
		return { status: "ok", bytes: stats.size };
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return { status: "missing", reason: "snapshot missing" };
		}
		throw error;
	}
}

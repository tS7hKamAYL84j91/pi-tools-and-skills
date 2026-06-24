/**
 * CoAS workspace filesystem operations.
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { appendLogLine } from "../../lib/file-persistence.js";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import {
	assertInside,
	assertNoSymlinkComponents,
	assertSafeId,
	ensurePrivateDir,
	formatEnv,
	isoUtc,
	parseEnv,
	pathInside,
	workspaceRoot,
	slugify,
	writePrivateFileAtomic,
} from "./store.js";
import type { CoasConfig, CreateWorkspaceInput, WorkspaceReadOptions, WorkspaceSummary } from "./types.js";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

const SUMMARY_HEAD_BYTES = 12 * 1024;
const LARGE_CONTEXT_BYTES = 64 * 1024;
const FULL_READ_MAX_BYTES = 128 * 1024;
const ARCHIVE_THRESHOLD_BYTES = 64 * 1024;

function workspacePath(config: CoasConfig, workspaceId: string): string {
	assertSafeId("workspace id", workspaceId);
	return join(workspaceRoot(config), workspaceId);
}

function workspaceMetadataPath(dir: string): string {
	return join(dir, ".pi", "coas", "workspace.env");
}

function hasWorkspaceMetadata(dir: string): boolean {
	return existsSync(workspaceMetadataPath(dir));
}

function assertAllowedWorkspacePath(config: CoasConfig, dir: string): void {
	const root = workspaceRoot(config);
	try {
		assertInside(root, dir);
		if (resolve(dir) !== resolve(root)) return;
	} catch {
		// Fall through to metadata check for explicitly selected external-but-real
		// workspaces. This preserves compatibility without allowing arbitrary paths.
	}
	if (hasWorkspaceMetadata(dir)) return;
	throw new Error(`Workspace path must be under ${root} or contain .pi/coas/workspace.env: ${dir}`);
}

function resolveWorkspacePath(config: CoasConfig, selector: string | undefined, cwd: string): string {
	if (!selector || selector.trim().length === 0) {
		if (existsSync(join(cwd, "CONTEXT.md"))) {
			assertAllowedWorkspacePath(config, cwd);
			return cwd;
		}
		const envId = process.env.COAS_WORKSPACE_ID;
		if (envId) return workspacePath(config, envId);
		throw new Error("No workspace selected and cwd is not a CoAS workspace");
	}
	if (selector.startsWith("/") || selector.startsWith("~/") || selector.startsWith(".")) {
		const expanded = expandHome(selector);
		const dir = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
		assertAllowedWorkspacePath(config, dir);
		return dir;
	}
	return workspacePath(config, selector);
}

async function assertNotSymlink(path: string): Promise<void> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) throw new Error(`Refusing CoAS workspace symlink: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}

async function assertSafeWorkspaceDir(config: CoasConfig, dir: string): Promise<void> {
	if (pathInside(workspaceRoot(config), dir)) {
		await assertNoSymlinkComponents(workspaceRoot(config), dir);
		return;
	}
	await assertNotSymlink(dir);
}

async function readWorkspaceEnv(dir: string): Promise<Record<string, string>> {
	const envPath = workspaceMetadataPath(dir);
	if (!existsSync(envPath)) return {};
	await assertNotSymlink(envPath);
	return parseEnv(await readFile(envPath, "utf8"));
}

export async function listWorkspaces(config: CoasConfig): Promise<WorkspaceSummary[]> {
	const root = workspaceRoot(config);
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const summaries: WorkspaceSummary[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = join(root, entry.name);
		const metadata = await readWorkspaceEnv(dir);
		summaries.push({
			id: metadata.WORKSPACE_ID ?? entry.name,
			path: dir,
			roomRef: metadata.ROOM_REF,
			purpose: metadata.PURPOSE,
			isolated: metadata.ISOLATED,
			updatedAt: metadata.UPDATED_AT,
			hasContext: existsSync(join(dir, "CONTEXT.md")),
		});
	}
	return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

function contextHeadings(text: string): string[] {
	return text.split("\n")
		.filter((line) => /^#{1,3}\s+/.test(line))
		.slice(0, 40);
}

function renderContextSummary(path: string, size: number, text: string, truncated: boolean): string {
	const headings = contextHeadings(text);
	const lines = [
		`CONTEXT.md: ${path}`,
		`Size: ${size} bytes${size > LARGE_CONTEXT_BYTES ? " (large; full read guarded)" : ""}`,
		"",
		"Headings:",
		...(headings.length > 0 ? headings.map((heading) => `- ${heading}`) : ["- (none in sampled content)"]),
		"",
		"Preview:",
		text.slice(0, SUMMARY_HEAD_BYTES).trimEnd(),
	];
	if (truncated) lines.push("", "Preview truncated. Use mode=section with a heading, or mode=full only for small context files.");
	return lines.join("\n");
}

function readSection(text: string, section: string): string | undefined {
	const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const startPattern = new RegExp(`^(#{1,6})\\s+.*${escaped}.*$`, "im");
	const match = startPattern.exec(text);
	if (!match || match.index === undefined) return undefined;
	const level = match[1]?.length ?? 1;
	const rest = text.slice(match.index + match[0].length + 1);
	const nextPattern = new RegExp(`^#{1,${level}}\\s+`, "im");
	const next = nextPattern.exec(rest);
	return `${match[0]}\n${next ? rest.slice(0, next.index) : rest}`.trimEnd();
}

export async function readWorkspaceContext(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
	options: WorkspaceReadOptions = {},
): Promise<{ path: string; text: string; mode: string; bytes: number }> {
	const dir = resolveWorkspacePath(config, selector, cwd);
	const path = join(dir, "CONTEXT.md");
	await assertSafeWorkspaceDir(config, dir);
	await assertNotSymlink(path);
	const info = await stat(path);
	const mode = options.mode ?? "summary";
	if (mode === "full") {
		if (info.size > FULL_READ_MAX_BYTES) {
			throw new Error(`CONTEXT.md is ${info.size} bytes; full reads are limited to ${FULL_READ_MAX_BYTES} bytes. Use mode=summary or mode=section.`);
		}
		return { path, text: await readFile(path, "utf8"), mode, bytes: info.size };
	}
	if (mode === "section") {
		if (info.size > FULL_READ_MAX_BYTES) {
			throw new Error(`CONTEXT.md is ${info.size} bytes; section reads are limited to ${FULL_READ_MAX_BYTES} bytes until archived/compacted.`);
		}
		if (!options.section || options.section.trim().length === 0) throw new Error("section is required when mode=section");
		const text = await readFile(path, "utf8");
		const section = readSection(text, options.section.trim());
		if (!section) throw new Error(`Section not found in CONTEXT.md: ${options.section}`);
		if (Buffer.byteLength(section, "utf8") > FULL_READ_MAX_BYTES) throw new Error(`Section is too large to return safely; refine the heading: ${options.section}`);
		return { path, text: section, mode, bytes: info.size };
	}
	const handle = await open(path, "r");
	try {
		const length = Math.min(info.size, SUMMARY_HEAD_BYTES);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, 0);
		const preview = buffer.toString("utf8");
		return { path, text: renderContextSummary(path, info.size, preview, info.size > length), mode: "summary", bytes: info.size };
	} finally {
		await handle.close();
	}
}

export async function appendWorkspaceContext(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
	text: string,
): Promise<{ path: string; bytes: number }> {
	if (text.trim().length === 0) throw new Error("Context update text must not be empty");
	const dir = resolveWorkspacePath(config, selector, cwd);
	const path = join(dir, "CONTEXT.md");
	await assertSafeWorkspaceDir(config, dir);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await assertNotSymlink(path);
	await withFileMutationQueue(path, async () => {
		const stamp = isoUtc();
		await appendLogLine(path, `\n\n## Update ${stamp}\n\n${text.trim()}\n`, { encoding: "utf8", mode: 0o600 });
		await compactContextIfNeeded(dir, path, stamp, text.trim());
		await chmod(path, 0o600).catch(() => undefined);
	});
	const info = await stat(path);
	return { path, bytes: info.size };
}

async function compactContextIfNeeded(dir: string, path: string, stamp: string, latestUpdate: string): Promise<void> {
	const info = await stat(path);
	if (info.size <= ARCHIVE_THRESHOLD_BYTES) return;
	const archiveDir = join(dir, "archive");
	await ensurePrivateDir(archiveDir);
	const archivePath = join(archiveDir, `CONTEXT.${stamp.replace(/[:]/g, "")}.md`);
	await copyFile(path, archivePath);
	await chmod(archivePath, 0o600).catch(() => undefined);
	const compact = [
		"# CoAS Workspace Context (SPR)",
		"",
		`- Compacted: ${stamp}`,
		`- Archived detailed history: ${archivePath}`,
		"- Policy: keep active CONTEXT.md small; store stable, non-secret memory only.",
		"",
		"## Stable Memory",
		"",
		latestUpdate,
		"",
		"## Archive Index",
		"",
		`- ${stamp}: ${archivePath}`,
		"",
	].join("\n");
	await writeFile(path, compact, { encoding: "utf8", mode: 0o600 });
}

export async function createWorkspace(config: CoasConfig, input: CreateWorkspaceInput): Promise<{ path: string; workspaceId: string; dryRun: boolean }> {
	const workspaceId = slugify(input.workspace);
	assertSafeId("workspace id", workspaceId);
	const dir = workspacePath(config, workspaceId);
	const envPath = workspaceMetadataPath(dir);
	const contextPath = join(dir, "CONTEXT.md");
	if (input.dryRun) return { path: dir, workspaceId, dryRun: true };

	await assertSafeWorkspaceDir(config, dir);
	await ensurePrivateDir(dir);
	await ensurePrivateDir(join(dir, ".pi"));
	await ensurePrivateDir(join(dir, ".pi", "coas"));
	await ensurePrivateDir(join(dir, "logs"));
	await ensurePrivateDir(join(dir, "tmp"));

	const now = isoUtc();
	let createdAt = now;
	if (existsSync(envPath)) {
		const existing = parseEnv(await readFile(envPath, "utf8"));
		createdAt = existing.CREATED_AT ?? now;
	}
	await assertNotSymlink(contextPath);
	if (!existsSync(contextPath)) {
		await appendLogLine(contextPath, [
			`# CoAS Workspace: ${workspaceId}`,
			"",
			`- Room/reference: ${input.room || "unknown"}`,
			`- Purpose: ${input.purpose || "Unspecified"}`,
			`- Isolation requested: ${input.isolated ? 1 : 0}`,
			`- Created: ${now}`,
			"",
			"## Operating Notes",
			"",
			"Use this file as small SPR-style durable room/workspace context. Read summaries first; request sections only when needed.",
			"Update it only with stable, useful facts. Do not write secrets here. Bulky detail is archived automatically.",
			"",
			"## Durable Memory",
			"",
			"- (empty)",
			"",
		].join("\n"), { encoding: "utf8", mode: 0o600 });
		await chmod(contextPath, 0o600).catch(() => undefined);
	}
	await writeWorkspaceEnv(envPath, {
		WORKSPACE_ID: workspaceId,
		ROOM_REF: input.room,
		PURPOSE: input.purpose ?? "",
		ISOLATED: input.isolated ? "1" : "0",
		WORKSPACE_DIR: dir,
		CONTEXT_FILE: contextPath,
		CREATED_AT: createdAt,
		UPDATED_AT: now,
	});
	return { path: dir, workspaceId, dryRun: false };
}

async function writeWorkspaceEnv(path: string, values: Record<string, string>): Promise<void> {
	await withFileMutationQueue(path, async () => {
		await writePrivateFileAtomic(path, formatEnv(values));
	});
}

export function formatWorkspaceList(workspaces: WorkspaceSummary[]): string {
	if (workspaces.length === 0) return "No CoAS workspaces found.";
	return workspaces.map((workspace) => {
		const purpose = workspace.purpose ? ` — ${workspace.purpose}` : "";
		const room = workspace.roomRef ? ` (${workspace.roomRef})` : "";
		const context = workspace.hasContext ? "CONTEXT.md" : "missing CONTEXT.md";
		return `- ${workspace.id}${room}${purpose}\n  ${workspace.path}\n  ${context}`;
	}).join("\n");
}

export function currentWorkspaceLabel(cwd: string): string | undefined {
	if (existsSync(join(cwd, "CONTEXT.md"))) return basename(cwd);
	return process.env.COAS_WORKSPACE_ID;
}

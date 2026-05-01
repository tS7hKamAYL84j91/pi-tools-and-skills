/**
 * CoAS workspace filesystem operations.
 */

import { existsSync } from "node:fs";
import { appendFile, chmod, lstat, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
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
import type { CoasConfig, CreateWorkspaceInput, WorkspaceSummary } from "./types.js";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function workspacePath(config: CoasConfig, workspaceId: string): string {
	assertSafeId("workspace id", workspaceId);
	return join(workspaceRoot(config), workspaceId);
}

function hasWorkspaceMetadata(dir: string): boolean {
	return existsSync(join(dir, ".coas", "workspace.env"));
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
	throw new Error(`Workspace path must be under ${root} or contain .coas/workspace.env: ${dir}`);
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
	const envPath = join(dir, ".coas", "workspace.env");
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

export async function readWorkspaceContext(config: CoasConfig, selector: string | undefined, cwd: string): Promise<{ path: string; text: string }> {
	const dir = resolveWorkspacePath(config, selector, cwd);
	const path = join(dir, "CONTEXT.md");
	await assertSafeWorkspaceDir(config, dir);
	await assertNotSymlink(path);
	return { path, text: await readFile(path, "utf8") };
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
		await appendFile(path, `\n\n## Update ${stamp}\n\n${text.trim()}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(path, 0o600).catch(() => undefined);
	});
	const info = await stat(path);
	return { path, bytes: info.size };
}

export async function createWorkspace(config: CoasConfig, input: CreateWorkspaceInput): Promise<{ path: string; workspaceId: string; dryRun: boolean }> {
	const workspaceId = slugify(input.workspace);
	assertSafeId("workspace id", workspaceId);
	const dir = workspacePath(config, workspaceId);
	const envPath = join(dir, ".coas", "workspace.env");
	const contextPath = join(dir, "CONTEXT.md");
	if (input.dryRun) return { path: dir, workspaceId, dryRun: true };

	await assertSafeWorkspaceDir(config, dir);
	await ensurePrivateDir(dir);
	await ensurePrivateDir(join(dir, ".coas"));
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
		await appendFile(contextPath, [
			`# CoAS Workspace: ${workspaceId}`,
			"",
			`- Room/reference: ${input.room || "unknown"}`,
			`- Purpose: ${input.purpose || "Unspecified"}`,
			`- Isolation requested: ${input.isolated ? 1 : 0}`,
			`- Created: ${now}`,
			"",
			"## Operating Notes",
			"",
			"Use this file as durable room/workspace context. Read it before work when relevant.",
			"Update it only with stable, useful facts. Do not write secrets here.",
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

/**
 * CoAS workspace filesystem operations.
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import type { CoasConfig, WorkspaceSummary } from "./types.js";

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function unquoteShellValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).replace(/'"'"'/g, "'");
	}
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"');
	}
	return trimmed;
}

function parseEnv(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf("=");
		if (index <= 0) continue;
		const key = trimmed.slice(0, index);
		if (!/^[A-Z0-9_]+$/.test(key)) continue;
		values[key] = unquoteShellValue(trimmed.slice(index + 1));
	}
	return values;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function assertSafeWorkspaceId(workspaceId: string): void {
	if (!SAFE_ID_PATTERN.test(workspaceId) || workspaceId.includes("..")) {
		throw new Error(`Invalid workspace id: ${workspaceId}`);
	}
}

function workspaceRoot(config: CoasConfig): string {
	return join(config.coasHome, "workspaces");
}

function workspacePath(config: CoasConfig, workspaceId: string): string {
	assertSafeWorkspaceId(workspaceId);
	return join(workspaceRoot(config), workspaceId);
}

function isUnderWorkspaceRoot(config: CoasConfig, dir: string): boolean {
	const pathFromRoot = relative(resolve(workspaceRoot(config)), resolve(dir));
	return pathFromRoot.length > 0 && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
}

function hasWorkspaceMetadata(dir: string): boolean {
	return existsSync(join(dir, ".coas", "workspace.env"));
}

function assertAllowedWorkspacePath(config: CoasConfig, dir: string): void {
	if (isUnderWorkspaceRoot(config, dir) || hasWorkspaceMetadata(dir)) return;
	throw new Error(`Workspace path must be under ${workspaceRoot(config)} or contain .coas/workspace.env: ${dir}`);
}

function resolveWorkspacePath(config: CoasConfig, selector: string | undefined, cwd: string): string {
	if (!selector || selector.trim().length === 0) {
		if (existsSync(join(cwd, "CONTEXT.md"))) return cwd;
		const envId = process.env.COAS_WORKSPACE_ID;
		if (envId) return workspacePath(config, envId);
		throw new Error("No workspace selected and cwd has no CONTEXT.md");
	}
	if (selector.startsWith("/") || selector.startsWith("~/") || selector.startsWith(".")) {
		const expanded = expandHome(selector);
		const dir = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
		assertAllowedWorkspacePath(config, dir);
		return dir;
	}
	return workspacePath(config, selector);
}

async function readWorkspaceEnv(dir: string): Promise<Record<string, string>> {
	const envPath = join(dir, ".coas", "workspace.env");
	if (!existsSync(envPath)) return {};
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
	await mkdir(dir, { recursive: true });
	await withFileMutationQueue(path, async () => {
		const stamp = new Date().toISOString();
		await appendFile(path, `\n\n## Update ${stamp}\n\n${text.trim()}\n`, { encoding: "utf8", mode: 0o600 });
	});
	const info = await stat(path);
	return { path, bytes: info.size };
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

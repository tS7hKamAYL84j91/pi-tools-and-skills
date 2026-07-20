/**
 * CoAS workspace path resolution and validation helpers.
 */

import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
	assertInside,
	assertNoSymlinkComponents,
	assertSafeId,
	parseEnv,
	pathInside,
	workspaceRoot,
} from "./store.js";
import type { CoasConfig, WorkspaceSummary } from "./types.js";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export function workspacePath(config: CoasConfig, workspaceId: string): string {
	assertSafeId("workspace id", workspaceId);
	return join(workspaceRoot(config), workspaceId);
}

export function workspaceMetadataPath(dir: string): string {
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

export function resolveWorkspacePath(config: CoasConfig, selector: string | undefined, cwd: string): string {
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

export async function assertNotSymlink(path: string): Promise<void> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) throw new Error(`Refusing CoAS workspace symlink: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}

export async function assertSafeWorkspaceDir(config: CoasConfig, dir: string): Promise<void> {
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
	const promises = entries
		.filter((entry) => entry.isDirectory())
		.map(async (entry) => {
			const dir = join(root, entry.name);
			const metadata = await readWorkspaceEnv(dir);
			return {
				id: metadata.WORKSPACE_ID ?? entry.name,
				path: dir,
				roomRef: metadata.ROOM_REF,
				purpose: metadata.PURPOSE,
				isolated: metadata.ISOLATED,
				updatedAt: metadata.UPDATED_AT,
				hasContext: existsSync(join(dir, "CONTEXT.md")),
			};
		});
	const summaries = await Promise.all(promises);
	return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

export function currentWorkspaceLabel(cwd: string): string | undefined {
	if (existsSync(join(cwd, "CONTEXT.md"))) return basename(cwd);
	return process.env.COAS_WORKSPACE_ID;
}

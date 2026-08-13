/** CoAS workspace path resolution through confined capabilities. */

import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ConfinedStore, ensureRuntimeDirs } from "./store.js";
import { assertSafeId, parseEnv, pathInside, workspaceRoot } from "./store-paths.js";
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

async function openManagedWorkspaceStore(config: CoasConfig): Promise<ConfinedStore | undefined> {
	const homeStore = await ConfinedStore.openCoasHome(config);
	const root = workspaceRoot(config);
	if (!homeStore || !await homeStore.fileExists(root)) return undefined;
	return ConfinedStore.forWorkspaceRoot(config);
}

async function openWorkspaceStore(config: CoasConfig, dir: string): Promise<ConfinedStore | undefined> {
	const root = workspaceRoot(config);
	if (pathInside(root, dir) && resolve(dir) !== resolve(root)) return openManagedWorkspaceStore(config);
	return ConfinedStore.openExternalWorkspace(dir);
}

export async function createManagedWorkspaceStore(config: CoasConfig): Promise<ConfinedStore> {
	await ensureRuntimeDirs(config);
	return ConfinedStore.forWorkspaceRoot(config);
}

interface ResolvedWorkspace {
	readonly path: string;
	readonly store: ConfinedStore;
}

export async function resolveWorkspace(
	config: CoasConfig,
	selector: string | undefined,
	cwd: string,
): Promise<ResolvedWorkspace> {
	if (!selector || selector.trim().length === 0) {
		const cwdStore = await openWorkspaceStore(config, cwd);
		if (cwdStore && await cwdStore.fileExists(join(cwd, "CONTEXT.md"))) return { path: cwd, store: cwdStore };
		const envId = process.env.COAS_WORKSPACE_ID;
		if (envId) {
			const path = workspacePath(config, envId);
			const store = await openManagedWorkspaceStore(config);
			if (!store) throw new Error(`CoAS workspace root does not exist: ${workspaceRoot(config)}`);
			return { path, store };
		}
		throw new Error("No workspace selected and cwd is not a CoAS workspace");
	}
	const path = selector.startsWith("/") || selector.startsWith("~/") || selector.startsWith(".")
		? (() => {
			const expanded = expandHome(selector);
			return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
		})()
		: workspacePath(config, selector);
	const store = await openWorkspaceStore(config, path);
	if (!store) {
		throw new Error(`Workspace path must be under ${workspaceRoot(config)} or contain .pi/coas/workspace.env: ${path}`);
	}
	return { path, store };
}

async function readWorkspaceEnv(store: ConfinedStore, dir: string): Promise<Record<string, string>> {
	const content = await store.readOptionalFile(workspaceMetadataPath(dir));
	return content === undefined ? {} : parseEnv(content);
}

export async function listWorkspaces(config: CoasConfig): Promise<WorkspaceSummary[]> {
	const store = await openManagedWorkspaceStore(config);
	const root = workspaceRoot(config);
	if (!store) return [];
	const summaries: WorkspaceSummary[] = [];
	for (const entry of await store.readDirectory(root)) {
		if (!entry.isDirectory()) continue;
		const dir = join(root, entry.name);
		const metadata = await readWorkspaceEnv(store, dir);
		summaries.push({
			id: metadata.WORKSPACE_ID ?? entry.name,
			path: dir,
			roomRef: metadata.ROOM_REF,
			purpose: metadata.PURPOSE,
			isolated: metadata.ISOLATED,
			updatedAt: metadata.UPDATED_AT,
			hasContext: await store.fileExists(join(dir, "CONTEXT.md")),
		});
	}
	return summaries.sort((first, second) => first.id.localeCompare(second.id));
}

export async function currentWorkspaceLabel(config: CoasConfig, cwd: string): Promise<string | undefined> {
	const store = await openWorkspaceStore(config, cwd);
	if (store && await store.fileExists(join(cwd, "CONTEXT.md"))) return basename(cwd);
	return process.env.COAS_WORKSPACE_ID;
}

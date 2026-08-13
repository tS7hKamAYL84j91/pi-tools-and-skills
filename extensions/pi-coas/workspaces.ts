/** CoAS workspace filesystem operations. */

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { formatEnv, isoUtc, parseEnv, slugify } from "./store-paths.js";
import {
	createManagedWorkspaceStore,
	currentWorkspaceLabel,
	listWorkspaces,
	workspaceMetadataPath,
	workspacePath,
} from "./workspace-paths.js";
import { appendWorkspaceContext, readWorkspaceContext } from "./workspace-context.js";
import type { CoasConfig, CreateWorkspaceInput, WorkspaceSummary } from "./types.js";

export { appendWorkspaceContext, currentWorkspaceLabel, listWorkspaces, readWorkspaceContext };

export async function createWorkspace(
	config: CoasConfig,
	input: CreateWorkspaceInput,
): Promise<{ path: string; workspaceId: string; dryRun: boolean }> {
	const workspaceId = slugify(input.workspace);
	const dir = workspacePath(config, workspaceId);
	const envPath = workspaceMetadataPath(dir);
	const contextPath = join(dir, "CONTEXT.md");
	if (input.dryRun) return { path: dir, workspaceId, dryRun: true };

	const store = await createManagedWorkspaceStore(config);
	for (const path of [dir, join(dir, ".pi"), join(dir, ".pi", "coas"), join(dir, "logs"), join(dir, "tmp")]) {
		await store.ensurePrivateDir(path);
	}

	const now = isoUtc();
	const existing = await store.readOptionalFile(envPath);
	const createdAt = existing === undefined ? now : parseEnv(existing).CREATED_AT ?? now;
	if (!await store.fileExists(contextPath)) {
		await store.appendPrivateLog(contextPath, [
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
		].join("\n"));
	}
	await withFileMutationQueue(envPath, async () => {
		await store.writePrivateFileAtomic(envPath, formatEnv({
			WORKSPACE_ID: workspaceId,
			ROOM_REF: input.room,
			PURPOSE: input.purpose ?? "",
			ISOLATED: input.isolated ? "1" : "0",
			WORKSPACE_DIR: dir,
			CONTEXT_FILE: contextPath,
			CREATED_AT: createdAt,
			UPDATED_AT: now,
		}));
	});
	return { path: dir, workspaceId, dryRun: false };
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

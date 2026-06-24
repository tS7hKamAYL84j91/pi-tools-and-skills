/**
 * CoAS workspace filesystem operations.
 */

import { existsSync } from "node:fs";
import { chmod, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { appendLogLine, writeFileAtomic } from "../../lib/file-persistence.js";
import { ensurePrivateDir, formatEnv, isoUtc, parseEnv, slugify } from "./store.js";
import {
	assertNotSymlink,
	assertSafeWorkspaceDir,
	currentWorkspaceLabel,
	listWorkspaces,
	workspaceMetadataPath,
	workspacePath,
} from "./workspace-paths.js";
import { appendWorkspaceContext, readWorkspaceContext } from "./workspace-context.js";
import type { CoasConfig, CreateWorkspaceInput, WorkspaceSummary } from "./types.js";

export { appendWorkspaceContext, currentWorkspaceLabel, listWorkspaces, readWorkspaceContext };

export async function createWorkspace(config: CoasConfig, input: CreateWorkspaceInput): Promise<{ path: string; workspaceId: string; dryRun: boolean }> {
	const workspaceId = slugify(input.workspace);
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
		await ensurePrivateDir(dirname(path));
		await writeFileAtomic(path, formatEnv(values), { encoding: "utf8", mode: 0o600 });
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

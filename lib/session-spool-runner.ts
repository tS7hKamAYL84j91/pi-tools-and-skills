/** Explicit local session spooling runner behind the T-490 manifest gate. */

import { homedir } from "node:os";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { readSessionHookState } from "./session-hook-installer.js";
import { spoolSessionEntries, type SessionSpoolResult } from "./session-spool.js";

/** @public */
export const DEFAULT_PI_SESSION_SOURCE_ROOT = join(homedir(), ".pi", "agent", "sessions");

/** @public */
export interface SessionSpoolRunnerOptions {
	registryDir: string;
	sourceFile: string;
	sourceRoot?: string;
	agentId: string;
	name: string;
	cwd: string;
	maxEvents?: number;
}

/** @public */
export interface SessionSpoolRunnerResult extends SessionSpoolResult {
	manifestFound: boolean;
	sourceFile: string;
	prunedFiles: number;
}

function isWithin(parent: string, child: string): boolean {
	const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
	return child === parent || child.startsWith(normalizedParent);
}

async function resolveSourceFile(sourceFile: string, sourceRoot = DEFAULT_PI_SESSION_SOURCE_ROOT): Promise<string> {
	if (!sourceFile) throw new Error("sourceFile is required");
	const root = resolve(sourceRoot);
	const candidate = isAbsolute(sourceFile) ? resolve(sourceFile) : resolve(root, sourceFile);
	if (!isWithin(root, candidate)) throw new Error("sourceFile must stay inside sourceRoot");
	const stat = await lstat(candidate);
	if (!stat.isFile()) throw new Error("sourceFile must be a file");
	return candidate;
}

function parseJsonl(content: string): unknown[] {
	const entries: unknown[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			entries.push({ type: "unknown", malformed: true });
		}
	}
	return entries;
}

/** Run explicit local spooling once. No background hook or default path. */
export async function runSessionSpoolOnce(options: SessionSpoolRunnerOptions): Promise<SessionSpoolRunnerResult> {
	if (!options.registryDir) throw new Error("registryDir is required");
	const sourceFile = await resolveSourceFile(options.sourceFile, options.sourceRoot);
	const manifest = await readSessionHookState(options.registryDir);
	if (!manifest) throw new Error("session spool hook manifest is not installed for registryDir");
	const content = await readFile(sourceFile, "utf8");
	const entries = parseJsonl(content);
	const maxEvents = options.maxEvents ?? manifest.retentionEvents;
	const result = await spoolSessionEntries({
		enabled: true,
		registryDir: options.registryDir,
		agentId: options.agentId,
		name: options.name,
		cwd: options.cwd,
		entries,
		maxEvents,
	});
	if (!result.sessionFile) throw new Error("spool did not produce a session file");
	return { ...result, manifestFound: true, sourceFile, prunedFiles: 0 };
}

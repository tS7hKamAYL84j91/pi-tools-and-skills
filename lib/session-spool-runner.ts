/** Explicit local session spooling runner behind the T-490 manifest gate. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { readSessionHookState } from "./session-hook-installer.js";
import { spoolSessionEntries, type SessionSpoolResult } from "./session-spool.js";

/** @public */
export interface SessionSpoolRunnerOptions {
	registryDir: string;
	sourceFile: string;
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

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmpPath, content, "utf8");
	await rename(tmpPath, path);
}

/** Run explicit local spooling once. No background hook or default path. */
export async function runSessionSpoolOnce(options: SessionSpoolRunnerOptions): Promise<SessionSpoolRunnerResult> {
	if (!options.registryDir) throw new Error("registryDir is required");
	if (!options.sourceFile) throw new Error("sourceFile is required");
	if (!isAbsolute(options.sourceFile)) throw new Error("sourceFile must be absolute");
	const manifest = await readSessionHookState(options.registryDir);
	if (!manifest) throw new Error("session spool hook manifest is not installed for registryDir");
	const sourceFile = resolve(options.sourceFile);
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
	const sessionContent = await readFile(result.sessionFile, "utf8");
	await atomicWrite(result.sessionFile, sessionContent);
	return { ...result, manifestFound: true, sourceFile, prunedFiles: 0 };
}

/**
 * Spawner launch helpers — isolated from tool registration to keep the
 * spawner-tools module within its line budget.
 */

import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_SPAWN_NAME_ENV,
	PANOPTICON_VISIBILITY_ENV,
} from "../../../lib/agent-registry.js";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import { PANOPTICON_SCOPE_ENV, type AgentScope } from "./scope.js";

export function prepareSystemPromptTempDir(
	systemPrompt: string | undefined,
): { tempDir: string | undefined; args: string[] } {
	if (!systemPrompt) return { tempDir: undefined, args: [] };
	const tempDir = mkdtempSync(join(tmpdir(), "pi-spawn-"));
	chmodSync(tempDir, 0o700);
	const promptPath = join(tempDir, "system-prompt.md");
	writeFileAtomic(promptPath, systemPrompt, { mode: 0o600 });
	return { tempDir, args: ["--append-system-prompt", promptPath] };
}

export function cleanupTempDir(tempDir: string | undefined): void {
	if (!tempDir) return;
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		/* best-effort cleanup */
	}
}

export function buildSpawnEnv(
	registrySelfId: string,
	spawnName: string,
	scope: AgentScope | undefined,
): NodeJS.ProcessEnv {
	return {
		...process.env,
		[PANOPTICON_PARENT_ID_ENV]: registrySelfId,
		[PANOPTICON_VISIBILITY_ENV]: "scoped",
		[PANOPTICON_SPAWN_NAME_ENV]: spawnName,
		[PANOPTICON_SCOPE_ENV]: scope ?? "task",
	};
}

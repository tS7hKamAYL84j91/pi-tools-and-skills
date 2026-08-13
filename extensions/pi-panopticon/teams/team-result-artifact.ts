/** Durable, claim-checkable team-run result artifact persistence. */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import {
	assertPrivateFileForRead,
	assertPrivateFileTarget,
	ensurePrivateDirectory,
	setPrivateFileMode,
} from "../../../lib/private-local-mode.js";
import type { TeamRunResultArtifact } from "./types.js";

const ARTIFACT_VERSION = 1;
const SAFE_RUN_ID = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

export interface TeamRunResultArtifactMetadata {
	team: string;
	status: "completed" | "stopped";
	ok: boolean;
}

function assertSafeRunId(runId: string): void {
	if (runId.length > 128 || !SAFE_RUN_ID.test(runId)) {
		throw new Error(`Invalid team run id "${runId}".`);
	}
}

export function teamRunResultArtifactPath(runId: string, resultRoot: string): string {
	assertSafeRunId(runId);
	const root = resolve(resultRoot);
	const path = resolve(root, `${runId}.json`);
	const pathFromRoot = relative(root, path);
	if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
		throw new Error(`Team result artifact path escapes result root: ${runId}`);
	}
	return path;
}

export async function writeTeamRunResultArtifact(
	runId: string,
	result: string,
	metadata: TeamRunResultArtifactMetadata,
	resultRoot: string,
): Promise<{ path: string; artifact: TeamRunResultArtifact }> {
	const path = teamRunResultArtifactPath(runId, resultRoot);
	ensurePrivateDirectory(resolve(resultRoot));
	assertPrivateFileTarget(path);
	const artifact: TeamRunResultArtifact = {
		version: ARTIFACT_VERSION,
		runId,
		team: metadata.team,
		status: metadata.status,
		ok: metadata.ok,
		result,
		writtenAt: Date.now(),
	};
	await writeFileAtomic(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	setPrivateFileMode(path);
	return { path, artifact };
}

export async function readTeamRunResultArtifact(runId: string, resultRoot: string): Promise<TeamRunResultArtifact | undefined> {
	const path = teamRunResultArtifactPath(runId, resultRoot);
	try {
		assertPrivateFileForRead(path);
		const data = JSON.parse(await readFile(path, "utf8")) as TeamRunResultArtifact;
		if (data.version !== ARTIFACT_VERSION || data.runId !== runId) return undefined;
		return data;
	} catch {
		return undefined;
	}
}

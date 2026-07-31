/** Durable, claim-checkable team-run result artifact persistence. */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import type { TeamRunResultArtifact } from "./types.js";

const RESULTS_SUBDIR = "team-results";
const ARTIFACT_VERSION = 1;

export interface TeamRunResultArtifactMetadata {
	team: string;
	status: "completed" | "stopped";
	ok: boolean;
}

export function teamRunResultArtifactPath(runId: string, stateRoot: string): string {
	return join(stateRoot, RESULTS_SUBDIR, `${runId}.json`);
}

export async function writeTeamRunResultArtifact(
	runId: string,
	result: string,
	metadata: TeamRunResultArtifactMetadata,
	stateRoot: string,
): Promise<{ path: string; artifact: TeamRunResultArtifact }> {
	const resultsDir = join(stateRoot, RESULTS_SUBDIR);
	await mkdir(resultsDir, { recursive: true });
	const path = join(resultsDir, `${runId}.json`);
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
	return { path, artifact };
}

export async function readTeamRunResultArtifact(runId: string, stateRoot: string): Promise<TeamRunResultArtifact | undefined> {
	const path = teamRunResultArtifactPath(runId, stateRoot);
	try {
		const data = JSON.parse(await readFile(path, "utf8")) as TeamRunResultArtifact;
		if (data.version !== ARTIFACT_VERSION || data.runId !== runId) return undefined;
		return data;
	} catch {
		return undefined;
	}
}


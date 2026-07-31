/** Team-run terminal completion helper: write durable artifact, then transition status. */

import type { ToolResult } from "../../../lib/tool-result.js";
import type { TeamStateManager } from "./state.js";
import { writeTeamRunResultArtifact, type TeamRunResultArtifactMetadata } from "./team-result-artifact.js";

/** Result shape for team_run that includes the generated run id. */
export type TeamRunToolResult = ToolResult & { details: { runId: string } };

/** Resolve the state root directory for team-run result artifacts from the process environment. */
const TEAM_RUN_STATE_ENV = "COAS_" + "HOME";
export function resolveTeamRunStateRoot(): string {
	return process.env[TEAM_RUN_STATE_ENV] ?? "";
}

/** Coerce a generic handler result into a team_run result carrying runId. */
export function coerceTeamRunResult(result: ToolResult, runId: string): TeamRunToolResult {
	return { ...result, details: { ...result.details, runId } };
}

interface CompleteRunArgs {
	runId: string;
	teamId: string;
	startedAt: number;
	text: string;
	stopped: boolean;
	reason: string;
	stateManager: TeamStateManager;
	stateRoot: string;
}

/** Write the result artifact and emit the terminal state event. */
export async function completeRun(args: CompleteRunArgs): Promise<{ path: string; status: "stopped" | "completed" }> {
	const status = args.stopped ? "stopped" : "completed";
	const metadata: TeamRunResultArtifactMetadata = { team: args.teamId, status, ok: true };
	const artifact = await writeTeamRunResultArtifact(args.runId, args.text, metadata, args.stateRoot);
	const durationMs = Date.now() - args.startedAt;
	if (args.stopped) {
		args.stateManager.recordRunStopped(args.runId, durationMs, args.reason, args.text, artifact.path);
	} else {
		args.stateManager.recordRunCompleted(args.runId, durationMs, args.text, artifact.path);
	}
	return { path: artifact.path, status };
}

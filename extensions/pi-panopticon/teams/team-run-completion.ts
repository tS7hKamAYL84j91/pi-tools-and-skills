/** Team-run terminal completion helper: write durable artifact, then transition status. */

import type { ToolResult } from "../../../lib/tool-result.js";
import type { TeamStateManager } from "./state.js";
import { resolveTeamResultRoot } from "./team-paths.js";
import { writeTeamRunResultArtifact, type TeamRunResultArtifactMetadata } from "./team-result-artifact.js";

/** Result shape for team_run that includes the generated run id. */
export type TeamRunToolResult = ToolResult & { details: { runId: string } };

/** Coerce a generic handler result into a team_run result carrying runId. */
export function coerceTeamRunResult(result: ToolResult, runId: string): TeamRunToolResult {
	return { ...result, details: { ...result.details, runId } };
}

interface CompleteRunArgs {
	runId: string;
	teamId: string;
	startedAt: number;
	result: ToolResult;
	stateManager: TeamStateManager;
	cwd: string;
	resultRoot?: string;
}

/** Write the result artifact and emit the terminal state event. */
export async function completeRun(args: CompleteRunArgs): Promise<{ path: string; status: "stopped" | "completed" }> {
	const text = args.result.content[0]?.text ?? "";
	const stopped = args.stateManager.isStopRequested(args.runId) || args.result.details.stopped === true;
	const reason = typeof args.result.details.reason === "string"
		? args.result.details.reason
		: args.stateManager.stopReason(args.runId) ?? "stop requested";
	const status = stopped ? "stopped" : "completed";
	const metadata: TeamRunResultArtifactMetadata = { team: args.teamId, status, ok: true };
	const artifact = await writeTeamRunResultArtifact(
		args.runId,
		text,
		metadata,
		args.resultRoot ?? resolveTeamResultRoot(args.cwd),
	);
	const durationMs = Date.now() - args.startedAt;
	if (stopped) {
		args.stateManager.recordRunStopped(args.runId, durationMs, reason, text, artifact.path);
	} else {
		args.stateManager.recordRunCompleted(args.runId, durationMs, text, artifact.path);
	}
	return { path: artifact.path, status };
}

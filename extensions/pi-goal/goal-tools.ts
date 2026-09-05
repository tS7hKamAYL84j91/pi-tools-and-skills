/** Tool registrations for direct pi-goal execution. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runGateCommand } from "../../lib/gate-command.js";
import { ok } from "../../lib/tool-result.js";
import { goalScopeForContext, requireGoal } from "./goal-helpers.js";
import { loadGoal, transactGoal } from "./goal-persist.js";
import { renderGoalSummary } from "./goal-render.js";
import type { GoalRuntime } from "./goal-runtime.js";
import { stopGoal, updateGoal, withLifecycle } from "./goal-plan.js";
import type { GoalExpected, GoalState } from "./goal-types.js";

async function commitToolGoal(ctx: ExtensionContext, state: GoalState, candidate: GoalState): Promise<GoalState> {
	const expected: GoalExpected = { goalId: state.goalId, revision: state.revision };
	const result = await transactGoal(ctx.cwd, goalScopeForContext(ctx), expected, () => candidate);
	if (result.status === "conflict") throw new Error("Goal mutation conflicted with a newer authoritative revision");
	if (result.projection === "failed") {
		throw new Error(`Goal authority committed but projection failed: ${result.projectionError ?? "unknown projection error"}`);
	}
	if (result.state === null) throw new Error("Goal mutation unexpectedly deleted the goal");
	return result.state;
}

export function registerGoalTools(
	pi: ExtensionAPI,
	runtime: GoalRuntime,
	refreshUi: (ctx: ExtensionContext, state?: GoalState | null) => Promise<void>,
): void {
	pi.registerTool({
		name: "goal_get",
		label: "Goal Get",
		description: "Read the current project-local pi goal state.",
		promptSnippet: "Read the active project goal, source file, run status, and completion requirements.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
			const details = state ? ({ ...state } as Record<string, unknown>) : {};
			return ok(state ? renderGoalSummary(state) : "No pi goal is set.", details);
		},
	});

	pi.registerTool({
		name: "goal_complete",
		label: "Goal Complete",
		description: "Mark the active goal complete after auditing concrete evidence.",
		promptSnippet: "Mark the active project goal complete after the completion audit passes.",
		promptGuidelines: [
			"Use goal_complete only after auditing the active goal against current repository/filesystem state.",
			"Include concrete validation and completion evidence.",
		],
		parameters: Type.Object({
			evidence: Type.String({ description: "Concrete completion evidence and validation summary." }),
			gate_command: Type.Optional(Type.String({
				description: "Deprecated compatibility input. Ignored and never executed; only PI_GOAL_GATE_COMMAND configures the trusted gate.",
				deprecated: true,
			})),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const evidence = params.evidence.trim();
			if (!evidence) throw new Error("goal_complete requires non-empty evidence");
			const state = await requireGoal(ctx.cwd, goalScopeForContext(ctx));
			const gateCommand = process.env.PI_GOAL_GATE_COMMAND;
			if (gateCommand !== undefined) {
				const gate = await runGateCommand(gateCommand, ctx.cwd, signal);
				if (!gate.passed) {
					if (state.runActive) await saveFailedGoal(ctx, state, `Completion gate failed (exitCode=${gate.exitCode}).`);
					throw new Error(
						`goal_complete gate failed (exitCode=${gate.exitCode}): ${gate.stderrSummary || gate.stdoutSummary}`,
					);
				}
			}
			if (state.status !== "active" && state.status !== "planning") {
				throw new Error(`Cannot complete a ${state.status} goal`);
			}
			const next = withLifecycle(updateGoal(state, {
				status: "complete",
				executionState: "completed",
				runActive: false,
				completionEvidence: evidence,
				planRequired: false,
				planApproved: false,
				milestones: [],
				currentMilestoneIndex: 0,
				lastVerification: undefined,
			}), "completed", "Goal completed by root audit.");
			const persisted = await commitToolGoal(ctx, state, next);
			await refreshUi(ctx, persisted);
			return {
				...ok(`Goal complete. Evidence: ${evidence}`, { ...persisted } as Record<string, unknown>),
				terminate: true,
			};
		},
	});

	void runtime;

	async function saveFailedGoal(ctx: ExtensionContext, state: GoalState, error: string): Promise<GoalState> {
		const failed = stopGoal(state, "failed", error);
		const persisted = await commitToolGoal(ctx, state, failed);
		await refreshUi(ctx, persisted);
		return persisted;
	}
}

/**
 * Tool registrations for pi-goal.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok } from "../../lib/tool-result.js";
import { runGateCommand } from "../../lib/gate-command.js";
import { loadGoal, saveGoal } from "./goal-persist.js";
import {
	generatePlanState,
	getCurrentMilestone,
	updateGoal,
} from "./goal-plan.js";
import { requireGoal } from "./goal-helpers.js";
import { renderGoalSummary } from "./goal-render.js";
import type { GoalState } from "./goal-types.js";

export interface GoalRuntime {
	resolve: ((messages: readonly unknown[]) => void) | null;
	stopRequested: boolean;
	pendingMarker: string | null;
	cancelledMarkers: Set<string>;
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
		promptSnippet: "Read the active project goal, source file, run status, milestones, and completion requirements.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const state = await loadGoal(ctx.cwd);
			const details = state ? ({ ...state } as Record<string, unknown>) : {};
			return ok(state ? renderGoalSummary(state) : "No pi goal is set.", details);
		},
	});

	pi.registerTool({
		name: "goal_plan",
		label: "Goal Plan",
		description: "Generate or replace the reviewable plan for the active goal.",
		promptSnippet: "Set ordered milestones with validation commands for the active goal.",
		parameters: Type.Object({
			milestones: Type.Optional(
				Type.Array(
					Type.Object({
						id: Type.String({ description: "Stable milestone id" }),
						title: Type.String({ description: "Milestone title" }),
						validationCommand: Type.String({ description: "Command used to verify this milestone" }),
					}),
					{ description: "Ordered milestone list. Omit to auto-generate from the objective." },
				),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await requireGoal(ctx.cwd);
			if (state.status === "complete") {
				throw new Error("Cannot plan a complete goal");
			}
			const milestones = params.milestones
				? params.milestones.map((m) => ({
						id: m.id,
						title: m.title,
						validationCommand: m.validationCommand,
						status: "pending" as const,
					}))
				: undefined;
			const planned = generatePlanState(state, milestones);
			await saveGoal(ctx.cwd, planned);
			await refreshUi(ctx, planned);
			return ok(
				`Plan generated with ${planned.milestones.length} milestone(s). Review .pi/goal/PLAN.md, then use /goal approve or /goal run.`,
				{ ...planned } as Record<string, unknown>,
			);
		},
	});

	pi.registerTool({
		name: "goal_verify",
		label: "Goal Verify",
		description: "Record structured verification evidence for the current milestone.",
		promptSnippet: "Record the validation command result for the current milestone before calling goal_complete.",
		promptGuidelines: [
			"Call goal_verify after running the milestone's validation command.",
			"The recorded exitCode and outputSummary are persisted; goal_complete checks them against the current milestone.",
		],
		parameters: Type.Object({
			exitCode: Type.Number({ description: "Exit code from the validation command (0 = success)" }),
			outputSummary: Type.String({ description: "Summary of the validation output" }),
			milestoneIndex: Type.Optional(Type.Number({ description: "Milestone index to verify. Defaults to the current milestone." })),
			command: Type.Optional(Type.String({ description: "Validation command that was run. Defaults to the current milestone's command." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await requireGoal(ctx.cwd);
			if (state.status === "complete") {
				throw new Error("Cannot verify a complete goal");
			}
			if (!state.planRequired || state.milestones.length === 0) {
				throw new Error("No milestones to verify. Use /goal plan first.");
			}
			const idx = params.milestoneIndex ?? state.currentMilestoneIndex;
			const milestone = state.milestones[idx];
			if (!milestone) {
				throw new Error(`Milestone index ${idx} does not exist`);
			}
			const command = params.command ?? milestone.validationCommand;
			if (command !== milestone.validationCommand) {
				throw new Error(
					`Validation command mismatch for milestone ${milestone.id}: expected "${milestone.validationCommand}", got "${command}"`,
				);
			}
			const record = {
				milestoneIndex: idx,
				command,
				exitCode: params.exitCode,
				outputSummary: params.outputSummary,
				timestamp: new Date().toISOString(),
				runId: state.runId,
			};
			const next = updateGoal(state, { lastVerification: record });
			await saveGoal(ctx.cwd, next);
			await refreshUi(ctx, next);
			return ok(
				`Verification recorded for milestone ${idx + 1} (${milestone.title}): exitCode=${params.exitCode}`,
				{ ...next } as Record<string, unknown>,
			);
		},
	});

	pi.registerTool({
		name: "goal_complete",
		label: "Goal Complete",
		description: "Mark the current milestone or goal complete. Requires concrete evidence and passing milestone verification when a plan is in effect.",
		promptSnippet: "Mark the active project goal complete after the completion audit passes.",
		promptGuidelines: [
			"Use goal_complete only after auditing the active goal against current repository/filesystem state and include concrete evidence.",
			"When milestones are active, the current milestone must have a passing goal_verify record before goal_complete will succeed.",
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
			if (!evidence) {
				throw new Error("goal_complete requires non-empty evidence");
			}
			const gateCommand = process.env.PI_GOAL_GATE_COMMAND;
			if (gateCommand !== undefined) {
				const gate = await runGateCommand(gateCommand, ctx.cwd, signal);
				if (!gate.passed) {
					throw new Error(
						`goal_complete gate failed (exitCode=${gate.exitCode}): ${gate.stderrSummary || gate.stdoutSummary}`,
					);
				}
			}
			const state = await requireGoal(ctx.cwd);
			if (state.status !== "active" && state.status !== "planning") {
				throw new Error(`Cannot complete a ${state.status} goal`);
			}

			if (state.planRequired && state.milestones.length > 0) {
				const current = getCurrentMilestone(state);
				if (!current) {
					throw new Error("No current milestone to complete");
				}
				const verification = state.lastVerification;
				if (!verification || verification.milestoneIndex !== state.currentMilestoneIndex) {
					throw new Error(
						`Milestone "${current.title}" has no verification. Call goal_verify with the validation result first.`,
					);
				}
				if (verification.command !== current.validationCommand) {
					throw new Error(
						`Verification command mismatch for milestone "${current.title}": expected "${current.validationCommand}", got "${verification.command}"`,
					);
				}
				if (verification.exitCode !== 0) {
					throw new Error(
						`Milestone "${current.title}" verification failed (exitCode=${verification.exitCode}). Repair and re-run the validation before calling goal_complete.`,
					);
				}

				const nextMilestones = state.milestones.map((m, i) =>
					i === state.currentMilestoneIndex ? { ...m, status: "done" as const } : m,
				);
				const nextIndex = state.currentMilestoneIndex + 1;
				if (nextIndex < nextMilestones.length) {
					const advanced = nextMilestones.map((m, i) =>
						i === nextIndex ? { ...m, status: "in_progress" as const } : m,
					);
					const nextMilestone = advanced[nextIndex];
					if (!nextMilestone) {
						throw new Error("Invariant: next milestone missing after bounds check");
					}
					const next = updateGoal(state, {
						milestones: advanced,
						currentMilestoneIndex: nextIndex,
						lastVerification: undefined,
						status: "active",
						runActive: false,
					});
					await saveGoal(ctx.cwd, next);
					await refreshUi(ctx, next);
					return ok(
						`Milestone ${state.currentMilestoneIndex + 1} complete. Next milestone: ${nextMilestone.title}. Continue with /goal run.`,
						{ ...next } as Record<string, unknown>,
					);
				}

				const next = updateGoal(state, {
					milestones: nextMilestones,
					currentMilestoneIndex: nextIndex,
					status: "complete",
					runActive: false,
					completionEvidence: evidence,
					lastVerification: undefined,
				});
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				return {
					...ok(`Goal complete. Evidence: ${evidence}`, { ...next } as Record<string, unknown>),
					terminate: true,
				};
			}

			const next = updateGoal(state, {
				status: "complete",
				runActive: false,
				completionEvidence: evidence,
			});
			await saveGoal(ctx.cwd, next);
			await refreshUi(ctx, next);
			return {
				...ok(`Goal complete. Evidence: ${evidence}`, { ...next } as Record<string, unknown>),
				terminate: true,
			};
		},
	});
	// Keep lint happy: runtime is used by callers via the shared global runtime object,
	// but this registration function receives it for potential future use.
	void runtime;
}

/**
 * Backward-compatible barrel for pi-goal state modules.
 *
 * New code should import from the focused modules directly; this file is
 * retained to avoid breaking existing consumers.
 */
export type { GoalState } from "./goal-types.js";
export { renderGoalSummary } from "./goal-render.js";
export {
	generatePlanState,
	getCurrentMilestone,
	startRun,
	updateGoal,
} from "./goal-plan.js";
export {
	createTextGoal,
	loadGoal,
	saveGoal,
} from "./goal-persist.js";

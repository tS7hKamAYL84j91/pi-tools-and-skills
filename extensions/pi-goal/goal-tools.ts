/** Tool registrations for verified pi-goal completion and explicit blockers. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok } from "../../lib/tool-result.js";
import { blockGoal, verifyGoalCompletion } from "./goal-completion.js";
import { goalScopeForContext } from "./goal-helpers.js";
import { loadGoal } from "./goal-persist.js";
import { renderGoalSummary } from "./goal-render.js";
import type { GoalRuntime } from "./goal-runtime.js";
import type { GoalState } from "./goal-types.js";

function assertExclusiveTerminalCall(ctx: ExtensionContext, toolCallId: string, expectedName: string): void {
 const branch = ctx.sessionManager?.getBranch?.() ?? [];
 for (let index = branch.length - 1; index >= 0; index--) {
  const entry = branch[index] as { type?: unknown; message?: { role?: unknown; content?: unknown } } | undefined;
  if (entry?.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
  const calls = entry.message.content.filter((part): part is { type: "toolCall"; id: string; name: string } =>
   typeof part === "object" && part !== null && "type" in part && part.type === "toolCall" && "id" in part && typeof part.id === "string" && "name" in part && typeof part.name === "string");
  if (calls.length === 0) return; // Direct test/SDK calls may not have a stored assistant tool call.
  if (calls.length !== 1 || calls[0]?.id !== toolCallId || calls[0].name !== expectedName) {
   throw new Error(`${expectedName} must be the only tool call in its assistant turn; finish other tools, then retry.`);
  }
  return;
 }
}

export function registerGoalTools(
 pi: ExtensionAPI,
 _runtime: GoalRuntime,
 refreshUi: (ctx: ExtensionContext, state?: GoalState | null) => Promise<void>,
): void {
 pi.registerTool({
  name: "goal_get", label: "Goal Get",
  description: "Read the current project-local pi goal state.",
  promptSnippet: "Read the active project goal, source file, run status, and completion requirements.",
  parameters: Type.Object({}),
  async execute(_id, _params, _signal, _onUpdate, ctx) {
   const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
   return ok(state ? renderGoalSummary(state) : "No pi goal is set.", state ? { ...state } : {});
  },
 });
 pi.registerTool({
  name: "goal_complete", label: "Goal Complete",
  description: "Request goal completion through the operator-configured trusted verifier.",
  promptSnippet: "Complete only after every in-scope requirement is satisfied and the trusted verifier passes.",
  promptGuidelines: [
   "Use goal_complete only after auditing every requirement against current files and running relevant validation.",
   "goal_complete requires PI_GOAL_GATE_COMMAND configured by the operator; evidence prose cannot replace verification.",
   "If goal_complete returns a retryable rejection, repair within the current scope; use goal_block for a genuine blocker, never completion.",
  ],
  parameters: Type.Object({
   evidence: Type.String({ description: "Concrete completion evidence and validation summary." }),
   gate_command: Type.Optional(Type.String({
    description: "Deprecated compatibility input. Ignored and never executed; only PI_GOAL_GATE_COMMAND configures the trusted gate.",
    deprecated: true,
   })),
  }),
  async execute(id, params, signal, _onUpdate, ctx) {
   assertExclusiveTerminalCall(ctx, id, "goal_complete");
   const evidence = params.evidence.trim();
   if (!evidence) throw new Error("goal_complete requires non-empty evidence");
   const result = await verifyGoalCompletion(ctx, evidence, signal);
   await refreshUi(ctx, result.state);
   if (result.error) throw new Error(result.error);
   return { ...ok(`Goal complete — trusted verifier passed. Evidence: ${evidence}`, { ...result.state }), terminate: true };
  },
 });
 pi.registerTool({
  name: "goal_block", label: "Goal Block",
  description: "Pause a genuinely blocked goal without marking it complete or granting new authority.",
  promptSnippet: "Record a concrete blocker and checkable resume condition, then stop the goal run.",
  promptGuidelines: ["Use goal_block for genuinely missing input, permission or resources; do not use it for ordinary repairable test failures."],
  parameters: Type.Object({
   reason: Type.String({ description: "Concrete blocker; not a success claim." }),
   resume_when: Type.String({ description: "Checkable condition that permits explicit operator resume." }),
  }),
  async execute(id, params, _signal, _onUpdate, ctx) {
   assertExclusiveTerminalCall(ctx, id, "goal_block");
   const state = await blockGoal(ctx, params.reason, params.resume_when);
   await refreshUi(ctx, state);
   return { ...ok("Goal paused — blocked, not complete. Resume explicitly when the recorded condition is satisfied.", { ...state }), terminate: true };
  },
 });
}

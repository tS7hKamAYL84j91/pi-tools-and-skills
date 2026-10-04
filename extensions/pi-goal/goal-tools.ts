/** Tool registrations for verified pi-goal completion and explicit blockers. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ok } from "../../lib/tool-result.js";
import { blockGoal, verifyGoalCompletion } from "./goal-completion.js";
import { goalScopeForContext } from "./goal-helpers.js";
import { readGoalHook, saveGoalHook } from "./goal-hook.js";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
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
  name: "goal_hook", label: "Goal Completion Hook",
  description: "Inspect or amend the workspace-local completion hook in .pi/goal/settings.json. Saving does not execute it; goal_complete runs it. Authorized local agents may configure it, not bypass task requirements.",
  parameters: Type.Object({
   command: Type.Optional(Type.String({ description: "Hook shell command, run in this workspace; empty means unconfigured. Never include secrets." })),
   timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 86400000, description: "Hook timeout; default 15 minutes." })),
   expected_revision: Type.Optional(Type.String({ description: "Revision from inspection (or absent); reject a conflicting edit." })),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
   if (params.command === undefined && params.timeout_ms !== undefined) throw new Error("Supply command when setting hook timeout");
   const hook = params.command === undefined ? await readGoalHook(ctx.cwd)
    : await saveGoalHook(ctx.cwd, { command: params.command, timeoutMs: params.timeout_ms }, params.expected_revision);
   const details = hook ? { ...hook, command: formatGoalDiagnostic(hook.command), configured: Boolean(hook.command), path: ".pi/goal/settings.json" } : { configured: false, revision: "absent", path: ".pi/goal/settings.json" };
   return ok(hook?.command ? "Local completion hook configured; runs only on goal_complete." : "Completion hook missing; configure goal_hook or /goal hook before completion. Goal can start/stop independently.", details);
  },
 });
 pi.registerTool({
  name: "goal_get", label: "Goal Get",
  description: "Read the current project-local pi goal state.",
  promptSnippet: "Read the active project goal, source file, run status, and completion requirements.",
  parameters: Type.Object({}),
  async execute(_id, _params, _signal, _onUpdate, ctx) {
   const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
   let hookStatus: string;
   try { hookStatus = (await readGoalHook(ctx.cwd))?.command ? "Local completion hook configured (.pi/goal/settings.json)." : "Local completion hook missing; configure goal_hook or /goal hook."; }
   catch (error) { hookStatus = `Invalid local hook: ${formatGoalDiagnostic(error)}`; }
   return ok(`${state ? renderGoalSummary(state) : "No pi goal is set."}\n${hookStatus}`, state ? { ...state, hookStatus } : { hookStatus });
  },
 });
 pi.registerTool({
  name: "goal_complete", label: "Goal Complete",
  description: "Request goal completion by executing the workspace-local completion hook.",
  promptSnippet: "Complete only after auditing scope and passing the local completion hook.",
  promptGuidelines: [
   "Use goal_complete only after auditing every requirement against current files and running relevant validation.",
   "goal_complete runs the hook in .pi/goal/settings.json. If missing, declare and configure it using goal_hook locally; evidence prose cannot replace validation.",
   "If goal_complete returns a retryable rejection, repair within the current scope; use goal_block for a genuine blocker, never completion.",
  ],
  parameters: Type.Object({
   evidence: Type.String({ description: "Concrete completion evidence and validation summary." }),
   gate_command: Type.Optional(Type.String({
    description: "Deprecated compatibility input. Ignored and never executed; configure the local completion hook with goal_hook.",
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
   return { ...ok(`Goal complete — local completion hook passed. Evidence: ${evidence}`, { ...result.state }), terminate: true };
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

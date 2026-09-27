import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTextGoal, loadGoal, transactGoal } from "../../extensions/pi-goal/goal-persist.js";
import { startRun, stopGoal, updateGoal } from "../../extensions/pi-goal/goal-plan.js";
import { admitGoal, claimGoal } from "../../extensions/pi-goal/goal-ownership.js";
import { registerGoalTools } from "../../extensions/pi-goal/goal-tools.js";
import { goalContextMessage } from "../../extensions/pi-goal/prompts.js";
import * as gateModule from "../../lib/gate-command.js";
import { writeGoalFixture } from "../fixtures/goal-state.js";

interface Tool {
 name: string;
 execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: ExtensionContext): Promise<unknown>;
}
let cwd: string;
let tools: Map<string, Tool>;
let refresh: Parameters<typeof registerGoalTools>[2];
function call(name: string, params: Record<string, unknown>, signal?: AbortSignal, context?: ExtensionContext) {
 const tool = tools.get(name); if (!tool) throw new Error(`Missing ${name}`);
 return tool.execute("test", params, signal, undefined, context ?? ({ cwd } as ExtensionContext));
}
const complete = (signal?: AbortSignal) => call("goal_complete", { evidence: "All ten implemented; some smoke tests pass." }, signal);

beforeEach(async () => {
 vi.stubEnv("PI_GOAL_GATE_COMMAND", "exit 0");
 vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "0");
 cwd = await mkdtemp(join(tmpdir(), "goal-contract-"));
 await writeGoalFixture(cwd, startRun(await createTextGoal(cwd, "Complete all ten requirements"), 4, "continuous"));
 tools = new Map(); refresh = vi.fn(async () => undefined);
 registerGoalTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI,
  { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() }, refresh);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(cwd, { recursive: true, force: true }); });

describe("verified completion contract", () => {
 it("blocks the observed prose-only partial completion when no verifier exists", async () => {
  vi.stubEnv("PI_GOAL_GATE_COMMAND", undefined);
  await expect(complete()).rejects.toThrow(/verifier/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false });
  expect((await loadGoal(cwd))?.completionEvidence).toBeUndefined();
 });
 it("rejects completion batched with other tools before running the verifier", async () => {
  const context = { cwd, sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", content: [
   { type: "toolCall", id: "write-1", name: "write" }, { type: "toolCall", id: "test", name: "goal_complete" },
  ] } }] } } as unknown as ExtensionContext;
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(call("goal_complete", { evidence: "not exclusive" }, undefined, context)).rejects.toThrow(/only tool call/i);
  expect(gate).not.toHaveBeenCalled();
  expect((await loadGoal(cwd))?.runActive).toBe(true);
 });
 it("persists the trusted check rather than laundering the agent's claim", async () => {
  await complete();
  const state = await loadGoal(cwd);
  expect(state).toMatchObject({ status: "complete", runActive: false,
   completionCheck: { status: "passed", attempt: 1, maxAttempts: 1, exitCode: 0 } });
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(complete()).rejects.toThrow(/complete/i);
  expect(gate).not.toHaveBeenCalled();
 });
 it("permits fail -> repair -> pass only when opted in", async () => {
  vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "2");
  vi.stubEnv("PI_GOAL_GATE_COMMAND", "test -f accepted");
  await expect(complete()).rejects.toThrow(/repair/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "active", runActive: true,
   completionCheck: { status: "rejected", attempt: 1, maxAttempts: 3 } });
  await writeFile(join(cwd, "accepted"), "verified");
  await complete();
  expect(await loadGoal(cwd)).toMatchObject({ status: "complete", completionCheck: { status: "passed", attempt: 2 }, lastError: undefined });
 });
 it("persists the budget across tool registrations and stops at three checks", async () => {
  vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "2"); vi.stubEnv("PI_GOAL_GATE_COMMAND", "exit 1");
  for (let attempt = 1; attempt <= 3; attempt++) {
   registerGoalTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI,
    { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() }, refresh);
   await expect(complete()).rejects.toThrow(/gate/i);
   expect((await loadGoal(cwd))?.runActive).toBe(attempt < 3);
  }
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(complete()).rejects.toThrow(/paused/i);
  expect(gate).not.toHaveBeenCalled();
 });
 it.each(["exit 2", "exit 126", "command_that_does_not_exist_for_goal_test"])('contains execution/permission errors: %s', async command => {
  vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "2"); vi.stubEnv("PI_GOAL_GATE_COMMAND", command);
  await expect(complete()).rejects.toThrow(/gate/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false, completionCheck: { status: "error" } });
 });
 it("contains a timed-out verifier instead of consuming a repair", async () => {
  vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "2");
  vi.stubEnv("PI_GOAL_GATE_TIMEOUT_MS", "1000");
  vi.stubEnv("PI_GOAL_GATE_COMMAND", "sleep 5");
  await expect(complete()).rejects.toThrow(/timed out/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false,
   completionCheck: { status: "error", attempt: 1 } });
 });
 it("redacts verifier diagnostics before persistence and model feedback", async () => {
  vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "1");
  vi.stubEnv("PI_GOAL_GATE_COMMAND", "echo 'token=super-secret' >&2; exit 1");
  await expect(complete()).rejects.toThrow(/\[REDACTED\]/);
  const serialized = JSON.stringify(await loadGoal(cwd));
  expect(serialized).toContain("[REDACTED]");
  expect(serialized).not.toContain("super-secret");
 });
 it("contains an invalid operator repair policy", async () => {
  vi.stubEnv("PI_GOAL_REPAIR_ATTEMPTS", "3");
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(complete()).rejects.toThrow(/PI_GOAL_REPAIR_ATTEMPTS/);
  expect(gate).not.toHaveBeenCalled();
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false });
 });
 it("does not execute an already cancelled verifier", async () => {
  const controller = new AbortController(); controller.abort();
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(complete(controller.signal)).rejects.toThrow(/cancel/i);
  expect(gate).not.toHaveBeenCalled();
  expect((await loadGoal(cwd))?.runActive).toBe(false);
 });
 it("rejects a verifier result when operator policy changes in flight", async () => {
  let release: ((value: gateModule.GateResult) => void) | undefined;
  vi.spyOn(gateModule, "runGateCommand").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = complete();
  await vi.waitFor(() => expect(release).toBeDefined());
  vi.stubEnv("PI_GOAL_GATE_COMMAND", "exit 1");
  release?.({ passed: true, command: "exit 0", exitCode: 0, stdoutSummary: "passed", stderrSummary: "" });
  await expect(pending).rejects.toThrow(/policy changed/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false, completionCheck: { status: "error" } });
 });
 it("rejects concurrent and stale completion results after pause", async () => {
  let release: ((value: gateModule.GateResult) => void) | undefined;
  const gate = vi.spyOn(gateModule, "runGateCommand").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = complete();
  await vi.waitFor(() => expect(release).toBeDefined());
  await expect(complete()).rejects.toThrow(/in progress/i);
  expect(gate).toHaveBeenCalledTimes(1);
  const state = await loadGoal(cwd); if (!state) throw new Error("missing state");
  await transactGoal(cwd, undefined, { goalId: state.goalId, revision: state.revision }, current => current && updateGoal(stopGoal(current, "interrupted"), { status: "paused" }));
  release?.({ passed: true, command: "exit 0", exitCode: 0, stdoutSummary: "passed", stderrSummary: "" });
  await expect(pending).rejects.toThrow(/conflict/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false });
 });
 it("offers a genuine blocked outcome without completing or reprompting", async () => {
  await call("goal_block", { reason: "Required input missing", resume_when: "Operator supplies the input" });
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false,
   blocker: { reason: "Required input missing", resumeWhen: "Operator supplies the input" } });
  expect(goalContextMessage(await createTextGoal(cwd, "task"))).not.toContain("done, explicitly blocked, or out of scope");
 });
 it("keeps completed authority closed when terminal artifact projection fails", async () => {
  const claimed = await claimGoal(cwd); if (claimed.status !== "applied" || !claimed.state?.owner) throw new Error("claim missing");
  await admitGoal(cwd, undefined, claimed.state.owner, 1);
  await writeFile(join(cwd, ".pi/goal/runs"), "not a directory");
  await expect(complete()).rejects.toThrow(/projection failed/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "complete", runActive: false, turnsUsed: 1 });
 });
 it("counts terminal admission once and preserves an outcome artifact", async () => {
  const claimed = await claimGoal(cwd); if (claimed.status !== "applied" || !claimed.state?.owner) throw new Error("claim missing");
  await admitGoal(cwd, undefined, claimed.state.owner, 1);
  expect((await loadGoal(cwd))?.turnsUsed).toBe(1);
  await complete();
  expect((await loadGoal(cwd))?.turnsUsed).toBe(1);
  const files = await readdir(join(cwd, ".pi/goal/runs"), { recursive: true });
  const jsonl = files.find(file => file.endsWith("iter-001.jsonl"));
  expect(jsonl).toBeDefined();
  const receipt = await readFile(join(cwd, ".pi/goal/runs", jsonl ?? "missing"), "utf8");
  expect(receipt).toContain("goal-attempt-terminal");
  expect(receipt).toContain("completed");
  await expect(complete()).rejects.toThrow();
  expect((await loadGoal(cwd))?.turnsUsed).toBe(1);
 });
});

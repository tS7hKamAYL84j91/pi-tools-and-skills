import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTextGoal, loadGoal, transactGoal } from "../../extensions/pi-goal/goal-persist.js";
import { startRun, stopGoal, updateGoal } from "../../extensions/pi-goal/goal-plan.js";
import { admitGoal, claimGoal } from "../../extensions/pi-goal/goal-ownership.js";
import { saveGoalHook, readGoalHook } from "../../extensions/pi-goal/goal-hook.js";
import { registerGoalTools } from "../../extensions/pi-goal/goal-tools.js";
import * as gateModule from "../../lib/gate-command.js";
import { writeGoalFixture } from "../fixtures/goal-state.js";

interface Tool { name: string; execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: ExtensionContext): Promise<unknown>; }
let cwd: string;
let tools: Map<string, Tool>;
function call(name: string, params: Record<string, unknown>, signal?: AbortSignal, context?: ExtensionContext) {
 const tool = tools.get(name); if (!tool) throw new Error(`Missing ${name}`);
 return tool.execute("test", params, signal, undefined, context ?? ({ cwd } as ExtensionContext));
}
const complete = (signal?: AbortSignal) => call("goal_complete", { evidence: "Implementation and checks audited." }, signal);
beforeEach(async () => {
 cwd = await mkdtemp(join(tmpdir(), "goal-contract-"));
 await writeGoalFixture(cwd, startRun(await createTextGoal(cwd, "Complete all requirements"), 4, "continuous"));
 await saveGoalHook(cwd, { command: "exit 0" });
 tools = new Map();
 registerGoalTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI,
  { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() }, vi.fn(async () => {}));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(cwd, { recursive: true, force: true }); });
describe("local completion hook contract", () => {
 it("does not accept prose when hook is missing, even with legacy environment settings", async () => {
  await rm(join(cwd, ".pi/goal/settings.json"));
  vi.stubEnv("PI_GOAL_GATE_COMMAND", "exit 0");
  await expect(complete()).rejects.toThrow(/hook missing/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "active", runActive: true });
  expect((await loadGoal(cwd))?.completionEvidence).toBeUndefined();
 });
 it("rejects completion batched with another tool before executing", async () => {
  const ctx = { cwd, sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "write", name: "write" }, { type: "toolCall", id: "test", name: "goal_complete" }] } }] } } as unknown as ExtensionContext;
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(call("goal_complete", { evidence: "non-exclusive" }, undefined, ctx)).rejects.toThrow(/only tool call/);
  expect(gate).not.toHaveBeenCalled();
 });
 it("persists passing validation and never reopens completed authority", async () => {
  await complete();
  expect(await loadGoal(cwd)).toMatchObject({ status: "complete", runActive: false, completionCheck: { status: "passed", exitCode: 0 } });
  await saveGoalHook(cwd, { command: "exit 1" });
  await expect(complete()).rejects.toThrow(/complete/i);
  expect((await loadGoal(cwd))?.completionCheck?.status).toBe("passed"); // historical receipt, not a reusable current pass
 });
 it("allows fail, repair and pass without pausing or a session-wide attempt budget", async () => {
  await saveGoalHook(cwd, { command: "test -f accepted" });
  for (let i = 0; i < 4; i++) {
   await expect(complete()).rejects.toThrow(/repair/i);
   expect(await loadGoal(cwd)).toMatchObject({ status: "active", runActive: true, completionCheck: { status: "rejected" } });
  }
  await writeFile(join(cwd, "accepted"), "fixture"); await complete();
  expect(await loadGoal(cwd)).toMatchObject({ status: "complete", lastError: undefined });
 });
 it.each(["exit 2", "exit 126", "command_that_does_not_exist_for_goal_test"])("reports execution failure and stays open: %s", async command => {
  await saveGoalHook(cwd, { command });
  await expect(complete()).rejects.toThrow(/hook failed/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "active", runActive: true, completionCheck: { status: "error" } });
 });
 it("bounds execution time and keeps the goal open", async () => {
  await saveGoalHook(cwd, { command: "sleep 5", timeoutMs: 1000 });
  await expect(complete()).rejects.toThrow(/timed out/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "active", runActive: true, completionCheck: { status: "error" } });
 });
 it("redacts diagnostics before persistence and model feedback", async () => {
  await saveGoalHook(cwd, { command: "echo 'token=super-secret' >&2; exit 1" });
  await expect(complete()).rejects.toThrow(/\[REDACTED\]/);
  expect(JSON.stringify(await loadGoal(cwd))).not.toContain("super-secret");
 });
 it("contains invalid local configuration without executing or pausing", async () => {
  await writeFile(join(cwd, ".pi/goal/settings.json"), "{broken");
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(complete()).rejects.toThrow(/invalid local/i);
  expect(gate).not.toHaveBeenCalled();
  expect((await loadGoal(cwd))?.runActive).toBe(true);
 });
 it("never starts an already cancelled hook", async () => {
  const controller = new AbortController(); controller.abort();
  const gate = vi.spyOn(gateModule, "runGateCommand");
  await expect(complete(controller.signal)).rejects.toThrow(/cancel/i);
  expect(gate).not.toHaveBeenCalled();
 });
 it("discards a passing result after hook settings change, including command ABA", async () => {
  let release: ((value: gateModule.GateResult) => void) | undefined;
  vi.spyOn(gateModule, "runGateCommand").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = complete(); await vi.waitFor(() => expect(release).toBeDefined());
  await saveGoalHook(cwd, { command: "exit 1" });
  await saveGoalHook(cwd, { command: "exit 0" });
  release?.({ passed: true, command: "exit 0", exitCode: 0, stdoutSummary: "passed", stderrSummary: "" });
  await expect(pending).rejects.toThrow(/configuration changed/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "active", runActive: true, completionCheck: { status: "error" } });
 });
 it("rejects concurrent and stale results after explicit stop", async () => {
  let release: ((value: gateModule.GateResult) => void) | undefined;
  const gate = vi.spyOn(gateModule, "runGateCommand").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = complete(); await vi.waitFor(() => expect(release).toBeDefined());
  await expect(complete()).rejects.toThrow(/in progress/); expect(gate).toHaveBeenCalledTimes(1);
  const state = await loadGoal(cwd); if (!state) throw new Error("missing state");
  await transactGoal(cwd, undefined, { goalId: state.goalId, revision: state.revision }, current => current && updateGoal(stopGoal(current, "interrupted"), { status: "paused" }));
  release?.({ passed: true, command: "exit 0", exitCode: 0, stdoutSummary: "passed", stderrSummary: "" });
  await expect(pending).rejects.toThrow(/conflict/i);
  expect((await loadGoal(cwd))?.status).toBe("paused");
 });
 it("retains genuine blocker behavior", async () => {
  await call("goal_block", { reason: "Required input missing", resume_when: "Jim supplies input" });
  expect(await loadGoal(cwd)).toMatchObject({ status: "paused", runActive: false, blocker: { reason: "Required input missing" } });
 });
 it("keeps completed authority closed if terminal projection fails", async () => {
  const claimed = await claimGoal(cwd); if (claimed.status !== "applied" || !claimed.state?.owner) throw new Error("claim missing");
  await admitGoal(cwd, undefined, claimed.state.owner, 1);
  await writeFile(join(cwd, ".pi/goal/runs"), "not a directory");
  await expect(complete()).rejects.toThrow(/projection failed/i);
  expect(await loadGoal(cwd)).toMatchObject({ status: "complete", runActive: false, turnsUsed: 1 });
 });
 it("counts terminal admission once and preserves an outcome artifact", async () => {
  const claimed = await claimGoal(cwd); if (claimed.status !== "applied" || !claimed.state?.owner) throw new Error("claim missing");
  await admitGoal(cwd, undefined, claimed.state.owner, 1); await complete();
  expect((await loadGoal(cwd))?.turnsUsed).toBe(1);
  const files = await readdir(join(cwd, ".pi/goal/runs"), { recursive: true });
  const receipt = files.find(file => file.endsWith("iter-001.jsonl")); if (!receipt) throw new Error("receipt missing");
  expect(await readFile(join(cwd, ".pi/goal/runs", receipt), "utf8")).toContain("goal-attempt-terminal");
  expect(await readGoalHook(cwd)).toBeDefined();
 });
});

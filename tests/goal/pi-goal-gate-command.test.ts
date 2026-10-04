import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGoal, createTextGoal } from "../../extensions/pi-goal/goal-persist.js";
import { saveGoalHook } from "../../extensions/pi-goal/goal-hook.js";
import { writeGoalFixture } from "../fixtures/goal-state.js";
import { registerGoalTools } from "../../extensions/pi-goal/goal-tools.js";

const dirs: string[] = [];
function mockPi() {
 const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>, signal: AbortSignal, update: unknown, ctx: { cwd: string }) => Promise<unknown> }> = [];
 return { registerTool(tool: typeof tools[number]) { tools.push(tool); }, async call(name: string, cwd: string, params: Record<string, unknown>) {
  const tool = tools.find(t => t.name === name); if (!tool) throw new Error("missing tool");
  return tool.execute("id", params, new AbortController().signal, undefined, { cwd });
 } };
}
let pi: ReturnType<typeof mockPi>;
async function workspace() {
 const cwd = join(tmpdir(), `goal-local-gate-${process.pid}-${Date.now()}`);
 mkdirSync(cwd, { recursive: true }); dirs.push(cwd);
 await writeGoalFixture(cwd, await createTextGoal(cwd, "Local completion"));
 return cwd;
}
beforeEach(() => {
 pi = mockPi();
 registerGoalTools(pi as never, { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() }, async () => {});
});
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("goal_complete local hook", () => {
 it("completes on exit zero and retains evidence", async () => {
  const cwd = await workspace(); await saveGoalHook(cwd, { command: "exit 0" });
  await pi.call("goal_complete", cwd, { evidence: "All checks passed" });
  expect(await loadGoal(cwd)).toMatchObject({ status: "complete", completionEvidence: "All checks passed" });
 });
 it("leaves the goal open when the hook fails", async () => {
  const cwd = await workspace(); await saveGoalHook(cwd, { command: "echo 'gate failed' >&2; exit 1" });
  await expect(pi.call("goal_complete", cwd, { evidence: "must not persist" })).rejects.toThrow(/gate failed/);
  expect(await loadGoal(cwd)).toMatchObject({ status: "active", completionCheck: { status: "rejected" } });
  expect((await loadGoal(cwd))?.completionEvidence).toBeUndefined();
 });
 it("declares a missing hook without completing or pausing", async () => {
  const cwd = await workspace();
  await expect(pi.call("goal_complete", cwd, { evidence: "No hook" })).rejects.toThrow(/hook missing/i);
  expect((await loadGoal(cwd))?.status).toBe("active");
  expect((await loadGoal(cwd))?.completionEvidence).toBeUndefined();
 });
 it("ignores the deprecated gate_command argument", async () => {
  const cwd = await workspace(); await saveGoalHook(cwd, { command: "exit 0" });
  const marker = join(cwd, "extra-command-ran");
  await pi.call("goal_complete", cwd, { evidence: "Extra field inert", gate_command: `touch "${marker}"` });
  expect(existsSync(marker)).toBe(false);
  expect((await loadGoal(cwd))?.status).toBe("complete");
 });
 it("allows an authorized agent to configure locally without running the hook", async () => {
  const cwd = await workspace(); const marker = join(cwd, "hook-ran");
  await pi.call("goal_hook", cwd, { command: `touch "${marker}"`, expected_revision: "absent" });
  expect(existsSync(marker)).toBe(false);
  await pi.call("goal_complete", cwd, { evidence: "fixture verified" });
  expect(existsSync(marker)).toBe(true);
 });
});

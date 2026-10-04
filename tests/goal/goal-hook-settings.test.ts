import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hookPath, readGoalHook, saveGoalHook } from "../../extensions/pi-goal/goal-hook.js";
import { registerGoalCommands } from "../../extensions/pi-goal/goal-commands.js";
import type { GoalRuntime } from "../../extensions/pi-goal/goal-runtime.js";
import { createTextGoal, loadGoal } from "../../extensions/pi-goal/goal-persist.js";
import { startRun } from "../../extensions/pi-goal/goal-plan.js";
import { writeGoalFixture } from "../fixtures/goal-state.js";
let cwd: string;
beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), "goal-hook-settings-")); });
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });
async function command(args: string, edited?: string, edit?: () => Promise<string | undefined>, runtime?: GoalRuntime) {
 const handlers = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>();
 registerGoalCommands({ registerCommand: (name: string, value: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => handlers.set(name, value.handler) } as unknown as ExtensionAPI,
  runtime ?? { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() });
 const handler = handlers.get("goal"); if (!handler) throw new Error("missing handler");
 await handler(args, { cwd, mode: "tui", ui: { editor: edit ?? vi.fn(async () => edited), notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() } } as unknown as ExtensionCommandContext);
}
describe("local Goal hook settings and TUI", () => {
 it("is workspace-local, private, persistent, and conflict-checked", async () => {
  expect(await readGoalHook(cwd)).toBeUndefined();
  const first = await saveGoalHook(cwd, { command: "exit 0", timeoutMs: 1000 }, "absent");
  expect(await readGoalHook(cwd)).toEqual(first);
  expect((await stat(hookPath(cwd))).mode & 0o777).toBe(0o600);
  await expect(saveGoalHook(cwd, { command: "exit 1" }, "absent")).rejects.toThrow(/changed/);
  await saveGoalHook(cwd, { command: "exit 1" }, first.revision);
  expect((await readGoalHook(cwd))?.timeoutMs).toBe(1000);
  await expect(saveGoalHook(cwd, { command: "exit 0" }, first.revision)).rejects.toThrow(/changed/);
  const other = await mkdtemp(join(tmpdir(), "other-hook-"));
  try { expect(await readGoalHook(other)).toBeUndefined(); } finally { await rm(other, { recursive: true, force: true }); }
 });
 it("repairs malformed regular settings locally, but rejects symlinks", async () => {
  await mkdir(join(cwd, ".pi/goal"), { recursive: true });
  await writeFile(hookPath(cwd), "{broken");
  await expect(readGoalHook(cwd)).rejects.toThrow(/Malformed/);
  await saveGoalHook(cwd, { command: "exit 0" }, "invalid");
  await rm(hookPath(cwd));
  const target = join(cwd, "untouched"); await writeFile(target, "fixture");
  await symlink(target, hookPath(cwd));
  await expect(readGoalHook(cwd)).rejects.toThrow(/symlink/i);
  await expect(saveGoalHook(cwd, { command: "exit 0" })).rejects.toThrow(/symlink/i);
  expect(await readFile(target, "utf8")).toBe("fixture");
 });
 it.each([0, -1, 999, 86400001, 1000.5])("rejects invalid timeout %i without writing", async timeoutMs => {
  await expect(saveGoalHook(cwd, { command: "exit 0", timeoutMs })).rejects.toThrow(/timeoutMs/);
  expect(await readGoalHook(cwd)).toBeUndefined();
 });
 it("TUI cancel leaves config missing; save amends command and timeout", async () => {
  await command("hook"); expect(await readGoalHook(cwd)).toBeUndefined();
  await command("hook", JSON.stringify({ command: "exit 0", timeoutMs: 1000 }));
  expect(await readGoalHook(cwd)).toMatchObject({ command: "exit 0", timeoutMs: 1000 });
  await command("hook exit 1"); expect(await readGoalHook(cwd)).toMatchObject({ command: "exit 1", timeoutMs: 1000 });
 });
 it("rejects a stale TUI save instead of overwriting another local editor", async () => {
  await expect(command("hook", undefined, async () => {
   await saveGoalHook(cwd, { command: "exit 1" });
   return JSON.stringify({ command: "exit 0" });
  })).rejects.toThrow(/changed/);
  expect((await readGoalHook(cwd))?.command).toBe("exit 1");
 });
 it("a malformed TUI edit does not stop an existing driver", async () => {
  const runtime: GoalRuntime = { driver: { cwd, goalId: "fixture", token: "fixture", generation: 1, handoff: false }, resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() };
  await expect(command("hook", "{broken", undefined, runtime)).rejects.toThrow();
  expect(runtime.stopRequested).toBe(false);
  expect(runtime.driver?.token).toBe("fixture");
 });
 it("stop is independent of a hook; clear retains local settings", async () => {
  await writeGoalFixture(cwd, startRun(await createTextGoal(cwd, "fixture"), 4, "continuous"));
  await command("stop"); expect((await loadGoal(cwd))?.runActive).toBe(false);
  const hook = await saveGoalHook(cwd, { command: "exit 0" });
  await command("clear"); expect(await loadGoal(cwd)).toBeNull();
  expect(await readGoalHook(cwd)).toEqual(hook);
 });
});

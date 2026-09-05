/** Final T-886 regressions exercise authority changes at real async boundaries. */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createTextGoal, startRun, updateGoal } from "../../extensions/pi-goal/state.js";
import { loadGoal, transactGoal } from "../../extensions/pi-goal/goal-persist.js";
import { claimGoal, revokeGoal } from "../../extensions/pi-goal/goal-ownership.js";
import { runGoalLoop } from "../../extensions/pi-goal/goal-run-loop.js";
import type { GoalRuntime } from "../../extensions/pi-goal/goal-runtime.js";
import { startGoalWatchdog } from "../../extensions/pi-goal/goal-watchdog.js";

import { writeGoalFixture as saveGoal } from "../fixtures/goal-state.js";
const directories: string[] = [];
it("clears empty run directories without reporting a false cleanup failure", async () => {
 const { cwd } = await fixture();
 await mkdir(join(cwd, ".pi/goal/runs/2026/09/05"), { recursive: true });
 const state = await loadGoal(cwd); if (!state) { throw new Error("missing goal"); }
 const result = await transactGoal(cwd, undefined, { goalId: state.goalId, revision: state.revision }, () => null);
 expect(result.status === "applied" && result.projection).toBe("complete");
});
afterEach(async () => { for (const dir of directories.splice(0)) { await rm(dir, { recursive: true, force: true }); } });
async function fixture(turnsUsed = 0) {
 const cwd = await mkdtemp(join(tmpdir(), "goal-final-races-")); directories.push(cwd);
 const state = updateGoal(startRun(await createTextGoal(cwd, "race fixture"), 2, "continuous"), { turnsUsed });
 await saveGoal(cwd, state);
 const runtime: GoalRuntime = { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() };
 // Only the command host surface used by this fixture is supplied.
 const ctx = { cwd, sessionManager: { getSessionFile: () => undefined }, ui: { setStatus() {}, setWidget() {}, notify() {} }, waitForIdle: async () => {}, isIdle: () => true, hasPendingMessages: () => false } as unknown as ExtensionCommandContext;
 return { cwd, state, runtime, ctx };
}

it("does not account or interrupt a successor after an old driver's turn settles", async () => {
 const { cwd, state, runtime, ctx } = await fixture();
 let sent = false;
 const pi = { sendUserMessage: () => { sent = true; } } as unknown as ExtensionAPI;
 const running = runGoalLoop(pi, runtime, ctx, state);
 await vi.waitFor(() => expect(sent).toBe(true));
 const old = await loadGoal(cwd); if (!old?.owner) { throw new Error("missing claim"); }
 await revokeGoal(cwd, undefined, old.owner);
 const stopped = await loadGoal(cwd); if (!stopped) { throw new Error("missing goal"); }
 await transactGoal(cwd, undefined, { goalId: stopped.goalId, revision: stopped.revision }, current => current && { ...current, runActive: true });
 const successor = await claimGoal(cwd, undefined, "successor");
 runtime.resolve?.([]);
 await running;
 expect(await loadGoal(cwd)).toEqual(successor.status === "applied" ? successor.state : null);
});

it("rejects a replacement callback for another cwd before sending", async () => {
 const { cwd, state, runtime, ctx } = await fixture(1);
 let sends = 0;
 ctx.newSession = async options => {
  await options?.withSession?.({ ...ctx, cwd: join(cwd, "wrong"), sendUserMessage: async () => { sends++; runtime.resolve?.([]); } } as never);
  return { cancelled: false };
 };
 await expect(runGoalLoop({} as ExtensionAPI, runtime, ctx, state)).resolves.toBeUndefined();
 expect(sends).toBe(0);
 expect((await loadGoal(cwd))?.runActive).toBe(false);
});

it("revocation removes a pending replacement reservation", async () => {
 const { cwd } = await fixture();
 const claim = await claimGoal(cwd); if (claim.status !== "applied" || !claim.state?.owner) { throw new Error("missing claim"); }
 const state = claim.state;
 await transactGoal(cwd, undefined, { goalId: state.goalId, revision: state.revision, owner: state.owner }, current => current && { ...current, replacement: { attempt: 1, generation: state.owner?.generation ?? 1, revision: state.revision + 1 } });
 await revokeGoal(cwd, undefined, claim.state.owner);
 expect((await loadGoal(cwd))?.replacement).toBeUndefined();
});

it("two concurrent local starts cannot replace each other's waiter", async () => {
 const first = await fixture(); const second = await fixture();
 let sends = 0;
 const pi = { sendUserMessage: () => { sends++; first.runtime.resolve?.([]); } } as unknown as ExtensionAPI;
 await Promise.all([runGoalLoop(pi, first.runtime, first.ctx, first.state), runGoalLoop(pi, first.runtime, second.ctx, second.state)]);
 expect(sends).toBe(1);
});

it("an observer watchdog cannot act using an owner's persisted token", async () => {
 const { cwd, state } = await fixture();
 await saveGoal(cwd, { ...state, lastProgressAt: new Date(0).toISOString() });
 await claimGoal(cwd, undefined, "another-process");
 const before = await loadGoal(cwd);
 const scheduled: Array<() => void> = []; let notices = 0;
 const stop = startGoalWatchdog({ cwd, now: () => 10000, schedule: callback => { scheduled.push(callback); return {}; }, cancel() {}, isTurnActive: () => false, hasQueuedContinuation: () => false, notify: () => { notices++; }, sendNudge: () => { notices++; } }, { softTimeoutMs: 1000, hardTimeoutMs: 2000 });
 scheduled.shift()?.();
 await vi.waitFor(() => expect(scheduled.length).toBe(1));
 stop();
 expect(notices).toBe(0);
 expect(await loadGoal(cwd)).toEqual(before);
});

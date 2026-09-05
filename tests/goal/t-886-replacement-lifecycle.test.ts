/** Replacement fixture uses real SessionManagers and tears down the old host before callback. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import goalExtension from "../../extensions/pi-goal/goal-extension.js";
import { createTextGoal, loadGoal, transactGoalAt } from "../../extensions/pi-goal/goal-persist.js";
import { GOAL_BINDING_CUSTOM_TYPE, createGoalSessionScope } from "../../extensions/pi-goal/goal-binding.js";
import { getGoalRuntime } from "../../extensions/pi-goal/goal-runtime.js";

type ReplacementOptions = NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>;
type ReplacedSessionContext = Parameters<NonNullable<ReplacementOptions["withSession"]>>[0];
const dirs: string[] = [];
afterEach(async () => { for (const cwd of dirs.splice(0)) { await rm(cwd, { recursive: true, force: true }); } });

it("survives old shutdown, validates the new binding, and settles through reloaded extension hooks", async () => {
 const fixture = await host();
 await fixture.run();
 const state = await loadGoal(fixture.cwd, createGoalSessionScope(fixture.current()));
 expect(fixture.sends()).toBe(2);
 expect(state?.turnsUsed).toBe(2);
 expect(state?.runActive).toBe(false);
 expect(state?.owner).toBeUndefined();
 expect(state?.replacement).toBeUndefined();
 expect(getGoalRuntime().resolve).toBeNull();
 await fixture.shutdown();
});

it("rejects a same-workspace replacement with a different session identity and binding", async () => {
 const fixture = await host(true);
 await fixture.run();
 const state = await loadGoal(fixture.cwd, createGoalSessionScope(fixture.current()));
 expect(fixture.sends()).toBe(1);
 expect(state?.runActive).toBe(false);
 expect(state?.replacement).toBeUndefined();
 await fixture.shutdown();
});

it("normal shutdown revokes the owner and settles its local waiting run", async () => {
 const fixture = await host(false, true);
 const running = fixture.run();
 await vi.waitFor(() => expect(fixture.sends()).toBe(1));
 await fixture.shutdown();
 await running;
 const state = await loadGoal(fixture.cwd, createGoalSessionScope(fixture.current()));
 expect(state?.runActive).toBe(false);
 expect(state?.owner).toBeUndefined();
 expect(getGoalRuntime().resolve).toBeNull();
});

it("an unknown handoff outcome is interrupted rather than retried", async () => {
 const fixture = await host(false, false, true);
 await fixture.run();
 const state = await loadGoal(fixture.cwd, createGoalSessionScope(fixture.current()));
 expect(fixture.sends()).toBe(1);
 expect(state?.runActive).toBe(false);
 expect(state?.lastError).toContain("outcome unknown");
 await fixture.shutdown();
});

async function host(wrongCallback = false, holdFirst = false, unknownCallback = false) {
 const cwd = await mkdtemp(join(tmpdir(), "goal-real-replacement-")); dirs.push(cwd);
 let sends = 0;
 interface Host {
  ctx: ExtensionCommandContext;
  emit(name: string, event: unknown): Promise<void>;
  commands: Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>;
  invalidate(): void;
 }
 let current: Host;
 function create(manager: SessionManager): Host {
  let stale = false;
  const commands = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>();
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void>>>();
  function fresh() { if (stale) { throw new Error("STALE HOST ACCESS"); } }
  const hostApi = {
   registerCommand: (name: string, value: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => commands.set(name, value.handler),
   registerTool() {},
   on: (name: string, callback: (event: unknown, ctx: ExtensionContext) => Promise<void>) => handlers.set(name, [...(handlers.get(name) ?? []), callback]),
   appendEntry: (type: string, data: unknown) => { fresh(); manager.appendCustomEntry(type, data); },
   sendMessage() { fresh(); },
   sendUserMessage: () => { fresh(); sends++; if (!holdFirst) { void self.emit("agent_end", { messages: [{ role: "assistant", content: "done" }] }); } },
  };
  const ctx = {
   cwd,
   get sessionManager() { fresh(); return manager; },
   ui: { notify() { fresh(); }, setStatus() { fresh(); }, setWidget() { fresh(); } },
   waitForIdle: async () => { fresh(); }, isIdle: () => true, hasPendingMessages: () => false,
   newSession: async (options: Parameters<ExtensionCommandContext["newSession"]>[0]) => {
    fresh();
    await self.emit("session_shutdown", { reason: "new" });
    stale = true;
    const replacement = SessionManager.inMemory(cwd);
    await options?.setup?.(replacement);
    current = create(replacement);
    await current.emit("session_start", { reason: "new" });
    if (unknownCallback) { return { cancelled: false }; }
    const callbackCtx = wrongCallback ? { ...current.ctx, sessionManager: SessionManager.inMemory(cwd) } : current.ctx;
    await options?.withSession?.({ ...callbackCtx, sendMessage: async () => {}, sendUserMessage: async () => { sends++; await current.emit("agent_end", { messages: [{ role: "assistant", content: "done" }] }); } } as ReplacedSessionContext);
    return { cancelled: false };
   },
  } as unknown as ExtensionCommandContext; // Fixture implements the used host capability only.
  const self: Host = { ctx, commands, invalidate: () => { stale = true; }, emit: async (name, event) => { for (const handler of handlers.get(name) ?? []) { await handler(event, ctx); } } };
  goalExtension(hostApi as unknown as ExtensionAPI);
  return self;
 }
 const manager = SessionManager.inMemory(cwd);
 current = create(manager);
 const state = await createTextGoal(cwd, "real replacement fixture", createGoalSessionScope(current.ctx));
 await transactGoalAt(cwd, state.goalId, "absent", () => state);
 manager.appendCustomEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId: state.goalId });
 await current.emit("session_start", { reason: "startup" });
 return { cwd, current: () => current.ctx, sends: () => sends, run: async () => { await current.commands.get("goal")?.("run --turns 2", current.ctx); }, shutdown: () => current.emit("session_shutdown", { reason: "quit" }) };
}

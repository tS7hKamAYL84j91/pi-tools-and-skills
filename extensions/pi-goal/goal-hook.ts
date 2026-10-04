/** Confined workspace-local completion hook settings; edits never execute it. */
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { assertNoSymlinkComponents, assertSafeEntry, assertSafeGoalRoot } from "./goal-files.js";
import { STATE_DIR } from "./goal-types.js";

export interface GoalHook {
 readonly command: string;
 readonly timeoutMs: number;
 readonly revision: string;
}
export class GoalHookConfigurationError extends Error {}
export const DEFAULT_HOOK_TIMEOUT_MS = 15 * 60 * 1000;
export const hookPath = (cwd: string): string => join(cwd, STATE_DIR, "settings.json");

function validateGoalHook(value: unknown): { command: string; timeoutMs: number } {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoalHookConfigurationError("Goal hook settings must be an object");
 const data = value as Record<string, unknown>;
 if (typeof data.command !== "string" || data.command.length > 8000 || data.command.includes("\0")) throw new GoalHookConfigurationError("Goal hook command must be a string of at most 8000 characters without NUL");
 const timeoutMs = data.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
 if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 86_400_000) throw new GoalHookConfigurationError("Goal hook timeoutMs must be 1000..86400000");
 return { command: data.command.trim(), timeoutMs };
}

async function assertPath(cwd: string): Promise<void> {
 await assertSafeGoalRoot(cwd);
 await assertNoSymlinkComponents(cwd, hookPath(cwd));
 await assertSafeEntry(hookPath(cwd), "hook settings");
}
export async function readGoalHook(cwd: string): Promise<GoalHook | undefined> {
 await assertPath(cwd);
 try {
  if ((await stat(hookPath(cwd))).size > 32_000) throw new GoalHookConfigurationError("Goal hook settings exceed 32000 bytes");
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(await readFile(hookPath(cwd), "utf8")) as Record<string, unknown>; }
  catch (error) { if (error instanceof SyntaxError) throw new GoalHookConfigurationError("Malformed Goal hook JSON"); throw error; }
  const settings = validateGoalHook(raw);
  if (raw.schemaVersion !== 1 || typeof raw.revision !== "string" || !raw.revision) throw new GoalHookConfigurationError("Invalid Goal hook settings version/revision");
  return { ...settings, revision: raw.revision };
 } catch (error) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
  throw error;
 }
}

export async function saveGoalHook(cwd: string, value: unknown, expectedRevision?: string): Promise<GoalHook> {
 const settings = validateGoalHook(value);
 await assertPath(cwd);
 return withAdvisoryLock(hookPath(cwd), async () => {
  await assertPath(cwd);
  let current: GoalHook | undefined;
  let revision = "absent";
  try { current = await readGoalHook(cwd); revision = current?.revision ?? "absent"; }
  catch (error) { if (!(error instanceof GoalHookConfigurationError)) throw error; revision = "invalid"; }
  if (expectedRevision !== undefined && revision !== expectedRevision) throw new Error("Goal hook settings changed; reload before saving");
  const supplied = value as Record<string, unknown>;
  const next = { ...settings, timeoutMs: supplied.timeoutMs === undefined ? current?.timeoutMs ?? settings.timeoutMs : settings.timeoutMs, revision: randomUUID() };
  await writeFileAtomic(hookPath(cwd), `${JSON.stringify({ schemaVersion: 1, ...next }, null, 2)}\n`, { mode: 0o600 });
  return next;
 });
}

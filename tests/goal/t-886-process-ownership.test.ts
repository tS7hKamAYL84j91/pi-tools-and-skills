/** Independent processes share one confined ownership transaction; dead claims never expire. */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTextGoal, loadGoal, transactGoal } from "../../extensions/pi-goal/goal-persist.js";
import { startRun } from "../../extensions/pi-goal/goal-plan.js";
import { revokeGoal } from "../../extensions/pi-goal/goal-ownership.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";

it("permits one process claim and requires explicit revocation after that process exits", async () => {
 const cwd = await mkdtemp(join(tmpdir(), "goal-process-exclusion-"));
 try {
  const state = startRun(await createTextGoal(cwd, "process exclusion"), 2);
  await transactGoal(cwd, undefined, "absent", () => state);
  const extension = join(cwd, "claim-worker.ts");
  await writeFileAtomic(extension, `import {claimGoal} from ${JSON.stringify(new URL("../../extensions/pi-goal/goal-ownership.ts", import.meta.url).pathname)};\nexport default async function() { process.stdout.write((await claimGoal(process.argv[1])).status); }`);
  const script = `
   import {discoverAndLoadExtensions} from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))};
   const loaded = await discoverAndLoadExtensions([${JSON.stringify(extension)}], process.argv[1], ${JSON.stringify(join(cwd, "empty-agent-dir"))});
   if (loaded.errors.length) throw new Error("Fixture extension failed to load");
  `;
  const claim = async () => (await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, cwd], { timeout: 15000 })).stdout.trim();
  const results = await Promise.all([claim(), claim(), claim()]);
  expect(results.filter(result => result === "applied")).toHaveLength(1);
  expect(await claim()).toBe("conflict"); // Winner has exited, but no automatic takeover.
  const owned = await loadGoal(cwd); if (!owned?.owner) { throw new Error("Expected durable owner"); }
  await revokeGoal(cwd, undefined, owned.owner);
  const stopped = await loadGoal(cwd); if (!stopped) { throw new Error("Expected stopped state"); }
  await transactGoal(cwd, undefined, { goalId: stopped.goalId, revision: stopped.revision }, current => current && { ...current, runActive: true });
  expect(await claim()).toBe("applied");
 } finally { await rm(cwd, { recursive: true, force: true }); }
}, 30000);

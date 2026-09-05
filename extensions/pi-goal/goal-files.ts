/** Confined goal paths and derived artifacts; authority transactions live in goal-persist. */
import { existsSync } from "node:fs";
import { lstat, readFile, realpath, readdir, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { assertGoalId, goalPaths, INSTANCES_DIR, STATE_DIR } from "./goal-types.js";

function isConfinedPath(root: string, target: string): boolean {
 const pathFromRoot = relative(root, target);
 return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export async function normalizeProjectPath(cwd: string, inputPath: string): Promise<{ sourcePath: string; sourceRealPath: string }> {
 const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
 const projectPath = resolve(cwd);
 const absolute = resolve(projectPath, cleaned);
 const rel = relative(projectPath, absolute);
 if (rel === "" || !isConfinedPath(projectPath, absolute)) { throw new Error(`Goal source must be inside the project: ${inputPath}`); }
 try { await assertNoSymlinkComponents(cwd, absolute); }
 catch (error) {
  if (error instanceof Error && error.message.includes("symlink")) { throw new Error(`Goal source must not contain symlink components: ${inputPath}`); }
  throw error;
 }
 const [projectRealPath, sourceRealPath] = await Promise.all([realpath(projectPath), realpath(absolute)]);
 if (!isConfinedPath(projectRealPath, sourceRealPath) || sourceRealPath === projectRealPath) { throw new Error(`Goal source must resolve inside the project: ${inputPath}`); }
 return { sourcePath: rel, sourceRealPath };
}

export async function assertSafeGoalRoot(cwd: string, goalId?: string): Promise<void> {
 await assertNoSymlinkComponents(cwd, resolve(cwd, STATE_DIR));
 if (goalId !== undefined) {
  assertGoalId(goalId);
  await assertNoSymlinkComponents(cwd, resolve(cwd, INSTANCES_DIR));
  await assertNoSymlinkComponents(cwd, goalPaths(cwd, goalId).dir);
 }
}

export async function assertNoSymlinkComponents(cwd: string, target: string): Promise<void> {
 const project = resolve(cwd);
 const absolute = resolve(target);
 if (!isConfinedPath(project, absolute)) { throw new Error(`pi-goal path escapes the project: ${target}`); }
 let current = project;
 for (const part of relative(project, absolute).split(/[\\/]+/).filter(Boolean)) {
  current = join(current, part);
  const info = await lstat(current).catch((error: unknown) => isErrorCode(error, "ENOENT") ? undefined : Promise.reject(error));
  if (info?.isSymbolicLink()) { throw new Error(`pi-goal path contains a symlink: ${current}`); }
 }
}

export async function ensureRuntimeIgnored(cwd: string): Promise<void> {
 const gitExclude = join(cwd, ".git", "info", "exclude");
 if (!existsSync(dirname(gitExclude))) { return; }
 let current = "";
 if (existsSync(gitExclude)) { current = await readFile(gitExclude, "utf8"); }
 const ignoredPath = `${STATE_DIR}/`;
 if (current.split(/\r?\n/).includes(ignoredPath)) { return; }
 const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
 await writeFileAtomic(gitExclude, `${current}${prefix}${ignoredPath}\n`);
}

/** Deletes recognized artifacts only; unknown files survive explicit goal clear. */
export async function removeKnownRunArtifacts(path: string): Promise<void> {
 try {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) { throw new Error(`Unsafe pi-goal run artifact path: ${path}`); }
  if (entry.isFile()) {
   if (/^[^/]+-iter-\d{3}\.(jsonl|md)$/.test(path.split("/").at(-1) ?? "")) { await rm(path, { force: true }); }
   return;
  }
  if (!entry.isDirectory()) { throw new Error(`Unsafe pi-goal run artifact path: ${path}`); }
  for (const child of await readdir(path)) { await removeKnownRunArtifacts(join(path, child)); }
  if ((await readdir(path)).length === 0) { await rmdir(path); }
 } catch (error) {
  if (!isErrorCode(error, "ENOENT")) { throw error; }
 }
}

export async function assertSafeEntry(path: string, label: string): Promise<void> {
 try {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile()) { throw new Error(`Unsafe pi-goal ${label} path is a symlink or not a regular file: ${path}`); }
 } catch (error) {
  if (!isErrorCode(error, "ENOENT")) { throw error; }
 }
}

function isErrorCode(error: unknown, code: string): boolean {
 return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

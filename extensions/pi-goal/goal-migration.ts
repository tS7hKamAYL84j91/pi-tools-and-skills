/** Lock-protected, bounded migration from the legacy flat pi-goal layout. */
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { appendGoalBinding, type GoalSessionScope } from "./goal-binding.js";
import { assertGoalId, goalPaths, STATE_DIR, type GoalState } from "./goal-types.js";

const MIGRATION_MARKER = ".legacy-migration.json";
const MIGRATION_LOCK = ".legacy-migration";
const KNOWN_PROJECTION_FILES = ["goal.json", "GOAL.md", "TODO.md", "SPEC.md", "PLAN.md", "STATUS.md"] as const;
const MAX_RUN_FILES = 10_000;

interface GoalMigrationSupport {
	readonly assertNoSymlinkComponents: (cwd: string, target: string) => Promise<void>;
	readonly assertSafeGoalRoot: (cwd: string, goalId?: string) => Promise<void>;
	readonly regenerateDerivedFiles: (cwd: string, state: GoalState, goalId?: string) => Promise<void>;
	readonly ensureRuntimeIgnored: (cwd: string) => Promise<void>;
}

export async function migrateLegacyGoal(scope: GoalSessionScope, support: GoalMigrationSupport): Promise<string | undefined> {
	const root = resolve(scope.cwd, STATE_DIR);
	await support.assertNoSymlinkComponents(scope.cwd, root);
	const statePath = join(root, "goal.json");
	if (!existsSync(statePath)) return undefined;
	return withAdvisoryLock(join(root, MIGRATION_LOCK), async () => {
		const markerPath = join(root, MIGRATION_MARKER);
		if (existsSync(markerPath)) {
			await readMigrationMarker(markerPath);
			return undefined;
		}
		await assertLegacyLayout(root);
		const { parseGoalState } = await import("./goal-parse.js");
		const state = parseGoalState(JSON.parse(await readFile(statePath, "utf8")) as unknown);
		const goalId = assertGoalId(state.goalId);
		const instance = goalPaths(scope.cwd, goalId);
		await support.assertSafeGoalRoot(scope.cwd, goalId);
		await mkdir(instance.dir, { recursive: true });
		await writeFileAtomic(instance.statePath, `${JSON.stringify(state, null, 2)}\n`);
		await appendGoalBinding(scope, goalId);
		await writeFileAtomic(markerPath, `${JSON.stringify({ goalId, migratedAt: new Date().toISOString() })}\n`);
		await moveKnownLegacyFiles(root, instance.dir);
		await support.regenerateDerivedFiles(scope.cwd, state, goalId);
		await support.ensureRuntimeIgnored(scope.cwd);
		return goalId;
	});
}

async function moveKnownLegacyFiles(root: string, instanceDir: string): Promise<void> {
	for (const file of KNOWN_PROJECTION_FILES) {
		const source = join(root, file);
		if (file === "goal.json") {
			await rm(source, { force: true });
			continue;
		}
		if (existsSync(source)) await rename(source, join(instanceDir, file));
	}
	const runs = join(root, "runs");
	if (!existsSync(runs)) return;
	for (const source of await collectKnownRunFiles(runs)) {
		const destination = join(instanceDir, relative(root, source));
		await mkdir(resolve(destination, ".."), { recursive: true });
		await rename(source, destination);
	}
}

async function collectKnownRunFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	const visit = async (dir: string, depth: number): Promise<void> => {
		if (depth > 8) throw new Error(`Legacy pi-goal runs path is too deep: ${dir}`);
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			const info = await lstat(path);
			if (info.isSymbolicLink()) throw new Error(`Legacy pi-goal migration refuses symlink: ${path}`);
			if (info.isDirectory()) await visit(path, depth + 1);
			else if (info.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".md"))) {
				found.push(path);
				if (found.length > MAX_RUN_FILES) throw new Error("Legacy pi-goal migration run-file limit exceeded");
			}
		}
	};
	await visit(root, 0);
	return found;
}

async function assertLegacyLayout(root: string): Promise<void> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (entry.name === MIGRATION_LOCK || entry.name === `${MIGRATION_LOCK}.lock` || entry.name.endsWith(".lock-owner.tmp")) continue;
		const path = join(root, entry.name);
		const info = await lstat(path);
		if (info.isSymbolicLink()) throw new Error(`Legacy pi-goal migration refuses symlink: ${path}`);
		if (entry.name === "runs" && info.isDirectory()) await collectKnownRunFiles(path);
	}
}

async function readMigrationMarker(path: string): Promise<string> {
	const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("goalId" in parsed) || typeof parsed.goalId !== "string") {
		throw new Error(`Invalid pi-goal migration marker: ${path}`);
	}
	return assertGoalId(parsed.goalId);
}

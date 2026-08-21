/**
 * Goal persistence, creation, and derived-file helpers.
 */
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	goalPaths,
	STATE_DIR,
	type GoalState,
} from "./goal-types.js";
import {
	renderGoalMarkdown,
	renderIterationMarkdown,
	renderPlanMarkdown,
	renderSpecMarkdown,
	renderStatusMarkdown,
	renderTodoMarkdown,
} from "./goal-render.js";

export async function loadGoal(cwd: string): Promise<GoalState | null> {
	const paths = goalPaths(cwd);
	return withAdvisoryLock(paths.statePath, async () => {
		if (!existsSync(paths.statePath)) return null;
		const raw = await readFile(paths.statePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		const { parseGoalState } = await import("./goal-parse.js");
		const state = parseGoalState(parsed);
		if (state.schemaVersion === 3 && isLegacyState(parsed)) {
			await writeFileAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
		}
		await regenerateDerivedFiles(cwd, state);
		return state;
	});
}

export async function saveGoal(cwd: string, state: GoalState): Promise<void> {
	const paths = goalPaths(cwd);
	await withAdvisoryLock(paths.statePath, async () => {
		await mkdir(paths.dir, { recursive: true });

		// goal.json is authoritative. Projections follow so an interrupted save can
		// leave only stale derived files, which loadGoal deterministically repairs.
		await writeFileAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
		await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
		await writeFileAtomic(paths.specPath, renderSpecMarkdown(state));
		await writeFileAtomic(paths.planPath, renderPlanMarkdown(state));
		await writeFileAtomic(paths.statusPath, renderStatusMarkdown(state));
		await ensureRuntimeIgnored(cwd);
	});
}

function isLegacyState(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.schemaVersion === 1 || record.schemaVersion === 2 || typeof record.runMode !== "string" || typeof record.lastProgressAt !== "string";
}

async function regenerateDerivedFiles(cwd: string, state: GoalState): Promise<void> {
	const paths = goalPaths(cwd);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
	await writeFileAtomic(paths.specPath, renderSpecMarkdown(state));
	await writeFileAtomic(paths.planPath, renderPlanMarkdown(state));
	await writeFileAtomic(paths.statusPath, renderStatusMarkdown(state));
}

export async function writeGoalIteration(
	cwd: string,
	state: GoalState,
	iteration: number,
	messages: readonly unknown[],
): Promise<void> {
	const runId = state.runId ?? "manual";
	const now = new Date();
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const dir = join(goalPaths(cwd).dir, "runs", year, month, day);
	await mkdir(dir, { recursive: true });
	const prefix = `${runId}-iter-${String(iteration).padStart(3, "0")}`;
	await writeFileAtomic(
		join(dir, `${prefix}.jsonl`),
		`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
	);
	await writeFileAtomic(
		join(dir, `${prefix}.md`),
		renderIterationMarkdown(state, iteration),
	);
}

export async function clearGoal(cwd: string): Promise<void> {
	await rm(goalPaths(cwd).dir, { recursive: true, force: true });
}

export async function createFileGoal(cwd: string, inputPath: string): Promise<GoalState> {
	const { sourcePath } = await normalizeProjectPath(cwd, inputPath);
	return newGoal(`Complete the work described by ${sourcePath}`, sourcePath);
}

export async function createFileTodoGoal(
	cwd: string,
	inputPath: string,
): Promise<GoalState> {
	const { sourcePath, sourceRealPath } = await normalizeProjectPath(cwd, inputPath);
	const content = (await readFile(sourceRealPath, "utf8")).trim();
	if (!content) {
		throw new Error(`Goal source file is empty: ${inputPath}`);
	}
	const objective = `Complete the work described by ${sourcePath}\n\n${content}`;
	const paths = goalPaths(cwd);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.todoPath, renderTodoMarkdown(objective));
	await ensureRuntimeIgnored(cwd);
	return newGoal(
		`Complete the work described by ${sourcePath}`,
		relative(cwd, paths.todoPath),
	);
}

export async function createTextGoal(
	cwd: string,
	objective: string,
): Promise<GoalState> {
	const cleaned = objective.trim();
	if (!cleaned) {
		throw new Error("Goal text must be non-empty");
	}
	const paths = goalPaths(cwd);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.todoPath, renderTodoMarkdown(cleaned));
	await ensureRuntimeIgnored(cwd);
	return newGoal(cleaned, relative(cwd, paths.todoPath));
}

function newGoal(objective: string, sourcePath: string): GoalState {
	const now = new Date().toISOString();
	return {
		schemaVersion: 3,
		goalId: `g-${randomUUID()}`,
		objective,
		sourcePath,
		status: "active",
		runMode: "manual",
		executionState: "idle",
		createdAt: now,
		updatedAt: now,
		runActive: false,
		turnBudget: 0,
		turnsUsed: 0,
		currentMilestoneIndex: 0,
		milestoneRevision: 0,
		milestones: [],
		lastProgressAt: now,
		livenessEpoch: 0,
		livenessWarningIssued: false,
		livenessNudgeIssued: false,
		lifecycle: [],
		changedFiles: [],
	};
}

function isConfinedPath(root: string, target: string): boolean {
	const pathFromRoot = relative(root, target);
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

interface NormalizedProjectPath {
	sourcePath: string;
	sourceRealPath: string;
}

async function normalizeProjectPath(cwd: string, inputPath: string): Promise<NormalizedProjectPath> {
	const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	const projectPath = resolve(cwd);
	const absolute = resolve(projectPath, cleaned);
	const rel = relative(projectPath, absolute);
	if (rel === "" || !isConfinedPath(projectPath, absolute)) {
		throw new Error(`Goal source must be inside the project: ${inputPath}`);
	}
	let current = projectPath;
	for (const part of rel.split(/[\\/]+/).filter((segment) => segment.length > 0)) {
		current = join(current, part);
		const info = await lstat(current).catch((error: unknown) => {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				throw new Error(`Goal source file does not exist: ${inputPath}`);
			}
			throw error;
		});
		if (info.isSymbolicLink()) {
			throw new Error(`Goal source must not contain symlink components: ${inputPath}`);
		}
	}
	const [projectRealPath, sourceRealPath] = await Promise.all([realpath(projectPath), realpath(absolute)]);
	if (!isConfinedPath(projectRealPath, sourceRealPath) || sourceRealPath === projectRealPath) {
		throw new Error(`Goal source must resolve inside the project: ${inputPath}`);
	}
	return { sourcePath: rel, sourceRealPath };
}

async function ensureRuntimeIgnored(cwd: string): Promise<void> {
	const gitExclude = join(cwd, ".git", "info", "exclude");
	if (!existsSync(dirname(gitExclude))) {
		return;
	}
	let current = "";
	if (existsSync(gitExclude)) {
		current = await readFile(gitExclude, "utf8");
	}
	const ignoredPath = `${STATE_DIR}/`;
	if (current.split(/\r?\n/).includes(ignoredPath)) {
		return;
	}
	const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
	await writeFileAtomic(gitExclude, `${current}${prefix}${ignoredPath}\n`);
}

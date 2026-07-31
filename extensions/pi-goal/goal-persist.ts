/**
 * Goal persistence, creation, and derived-file helpers.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
	if (!existsSync(paths.statePath)) {
		return null;
	}
	const raw = await readFile(paths.statePath, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	const { parseGoalState } = await import("./goal-parse.js");
	const state = parseGoalState(parsed);
	await regenerateDerivedFiles(cwd, state);
	return state;
}

export async function saveGoal(cwd: string, state: GoalState): Promise<void> {
	const paths = goalPaths(cwd);
	await mkdir(paths.dir, { recursive: true });

	// Derived markdown files are written first; goal.json is authoritative and
	// written last. On a crash between writes, loadGoal regenerates missing files.
	await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
	await writeFileAtomic(paths.specPath, renderSpecMarkdown(state));
	await writeFileAtomic(paths.planPath, renderPlanMarkdown(state));
	await writeFileAtomic(paths.statusPath, renderStatusMarkdown(state));

	await writeFileAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
	await ensureRuntimeIgnored(cwd);
}

async function regenerateDerivedFiles(cwd: string, state: GoalState): Promise<void> {
	const paths = goalPaths(cwd);
	await mkdir(paths.dir, { recursive: true });
	if (!existsSync(paths.summaryPath)) {
		await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
	}
	if (!existsSync(paths.specPath)) {
		await writeFileAtomic(paths.specPath, renderSpecMarkdown(state));
	}
	if (!existsSync(paths.planPath)) {
		await writeFileAtomic(paths.planPath, renderPlanMarkdown(state));
	}
	if (!existsSync(paths.statusPath)) {
		await writeFileAtomic(paths.statusPath, renderStatusMarkdown(state));
	}
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

export function createFileGoal(cwd: string, inputPath: string): GoalState {
	const sourcePath = normalizeProjectPath(cwd, inputPath);
	return newGoal(`Complete the work described by ${sourcePath}`, sourcePath);
}

export async function createFileTodoGoal(
	cwd: string,
	inputPath: string,
): Promise<GoalState> {
	const sourcePath = normalizeProjectPath(cwd, inputPath);
	const content = (await readFile(join(cwd, sourcePath), "utf8")).trim();
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
		schemaVersion: 1,
		goalId: `g-${randomUUID()}`,
		objective,
		sourcePath,
		status: "active",
		createdAt: now,
		updatedAt: now,
		runActive: false,
		turnBudget: 0,
		turnsUsed: 0,
		currentMilestoneIndex: 0,
		milestones: [],
	};
}

function normalizeProjectPath(cwd: string, inputPath: string): string {
	const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	const absolute = resolve(cwd, cleaned);
	const rel = relative(cwd, absolute);
	if (rel.startsWith("..") || rel === "") {
		throw new Error(`Goal source must be inside the project: ${inputPath}`);
	}
	if (!existsSync(absolute)) {
		throw new Error(`Goal source file does not exist: ${inputPath}`);
	}
	return rel;
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

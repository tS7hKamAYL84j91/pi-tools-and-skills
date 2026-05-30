/**
 * Project-local goal state persistence, rendering, and validation helpers.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "../../lib/file-persistence.js";

type GoalStatus = "active" | "paused" | "complete";

export interface GoalState {
	readonly schemaVersion: 1;
	readonly goalId: string;
	readonly objective: string;
	readonly sourcePath?: string;
	readonly status: GoalStatus;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly runId?: string;
	readonly runStartedAt?: string;
	readonly runActive: boolean;
	readonly turnBudget: number;
	readonly turnsUsed: number;
	readonly lastError?: string;
	readonly completionEvidence?: string;
}

interface GoalPaths {
	readonly dir: string;
	readonly statePath: string;
	readonly summaryPath: string;
	readonly todoPath: string;
}

const STATE_DIR = join(".pi", "goal");
const LEGACY_STATE_DIR = ".pi-goal";
const STATE_FILE = "goal.json";
const SUMMARY_FILE = "GOAL.md";
const TODO_FILE = "TODO.md";

function goalPaths(cwd: string): GoalPaths {
	const dir = join(cwd, STATE_DIR);
	return {
		dir,
		statePath: join(dir, STATE_FILE),
		summaryPath: join(dir, SUMMARY_FILE),
		todoPath: join(dir, TODO_FILE),
	};
}

function legacyGoalDir(cwd: string): string {
	return join(cwd, LEGACY_STATE_DIR);
}

async function migrateLegacyGoalDir(cwd: string): Promise<void> {
	const paths = goalPaths(cwd);
	if (existsSync(paths.dir) || !existsSync(legacyGoalDir(cwd))) {
		return;
	}
	await mkdir(dirname(paths.dir), { recursive: true });
	await rename(legacyGoalDir(cwd), paths.dir);
}

export async function loadGoal(cwd: string): Promise<GoalState | null> {
	await migrateLegacyGoalDir(cwd);
	const paths = goalPaths(cwd);
	if (!existsSync(paths.statePath)) {
		return null;
	}
	const raw = await readFile(paths.statePath, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	return parseGoalState(parsed);
}

export async function saveGoal(cwd: string, state: GoalState): Promise<void> {
	await migrateLegacyGoalDir(cwd);
	const paths = goalPaths(cwd);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
	await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
	await ensureRuntimeIgnored(cwd);
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
	await rm(legacyGoalDir(cwd), { recursive: true, force: true });
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
	};
}

export function updateGoal(
	state: GoalState,
	patch: Partial<GoalState>,
): GoalState {
	return {
		...state,
		...patch,
		updatedAt: new Date().toISOString(),
	};
}

export function startRun(state: GoalState, turnBudget: number): GoalState {
	return updateGoal(state, {
		status: "active",
		runId: `run-${randomUUID()}`,
		runStartedAt: new Date().toISOString(),
		runActive: true,
		turnBudget,
		turnsUsed: 0,
		lastError: undefined,
	});
}

export function renderGoalSummary(state: GoalState): string {
	const source = state.sourcePath ? `\nSource: ${state.sourcePath}` : "";
	const run = state.runActive
		? `\nRun: ${state.turnsUsed}/${state.turnBudget}`
		: "";
	const evidence = state.completionEvidence
		? `\nEvidence: ${state.completionEvidence}`
		: "";
	const error = state.lastError ? `\nLast error: ${state.lastError}` : "";
	return `Goal ${state.goalId}\nStatus: ${state.status}${source}${run}\nObjective: ${state.objective}${evidence}${error}`;
}

function renderGoalMarkdown(state: GoalState): string {
	return `# Current pi Goal\n\n${renderGoalSummary(state)}\n`;
}

function renderIterationMarkdown(state: GoalState, iteration: number): string {
	return `# pi Goal Iteration ${iteration}\n\n${renderGoalSummary(state)}\n`;
}

function renderTodoMarkdown(objective: string): string {
	return `# TODO — Remaining Work

Single tracker for active work on this goal.

## Goal

${objective}

**🔴 AUTONOMY RULE — READ FIRST:**
The implementation agent is expected to complete outstanding items without asking the user for confirmation.

- Pick work from this TODO, implement it, validate it, and update this file.
- Use the smallest useful change.
- Preserve useful content; do not delete source material unless it is clearly duplicate, empty, generated junk, or moved with an auditable note.
- Prefer moves/renames over rewrites.
- Escalate architecture, security, broad policy decisions, or destructive cleanup to \`llm-council\` when available.
- Use \`navigator\` review when substantial repo changes are made and team tools are available.

Progress markers:
- \`[ ]\` Planned
- \`[~]\` In progress
- \`[R]\` Ready for review
- \`[x]\` Done
- \`[!]\` Blocked

---

## How to use this TODO

1. Claim an item — change \`[ ]\` to \`[~]\` and add a dated note with intended scope.
2. Implement the smallest useful change.
3. Refactor only as needed to keep the result simple.
4. Validate with project checks or a documented manual check.
5. Update docs/architecture notes when the project requires it.
6. Change to \`[R]\` when ready for review, then \`[x]\` after validation/review.
7. If blocked, change to \`[!]\`, record the blocker and next decision needed, then stop broadening scope.

## Remaining TODO Items

- [ ] (1.1) Inspect the current repository state and refine this TODO into concrete, verifiable tasks derived from the goal.
- [ ] (1.2) Implement the smallest useful change that advances the goal.
- [ ] (1.3) Validate the result and record evidence.
- [ ] (1.4) Final summary: what changed, what stayed unchanged, validation performed, and any blockers or follow-up work.

---

## Completion Criteria

- All TODO items are \`[x]\`, \`[R]\` with review notes, or \`[!]\` with explicit blockers.
- Required validation has passed or has a documented reason why it cannot run.
- Final state and evidence are recorded in this file.
`;
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

function parseGoalState(value: unknown): GoalState {
	if (!isRecord(value)) {
		throw new Error("Invalid goal state: expected object");
	}
	const status = readStatus(value.status);
	return {
		schemaVersion: 1,
		goalId: readString(value.goalId, "goalId"),
		objective: readString(value.objective, "objective"),
		sourcePath: readOptionalString(value.sourcePath),
		status,
		createdAt: readString(value.createdAt, "createdAt"),
		updatedAt: readString(value.updatedAt, "updatedAt"),
		runId: readOptionalString(value.runId),
		runStartedAt: readOptionalString(value.runStartedAt),
		runActive: value.runActive === true,
		turnBudget: readNumber(value.turnBudget, "turnBudget"),
		turnsUsed: readNumber(value.turnsUsed, "turnsUsed"),
		lastError: readOptionalString(value.lastError),
		completionEvidence: readOptionalString(value.completionEvidence),
	};
}

function readStatus(value: unknown): GoalStatus {
	if (value === "active" || value === "paused" || value === "complete") {
		return value;
	}
	throw new Error(`Invalid goal state: status=${String(value)}`);
}

function readString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Invalid goal state: ${field} must be a non-empty string`);
	}
	return value;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(
			`Invalid goal state: ${field} must be a non-negative integer`,
		);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

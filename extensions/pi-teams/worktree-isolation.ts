/** Experimental git worktree isolation helpers for mutating team workers. */

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH_PREFIX = "pi-teams/worker";

interface ExecResult {
	stdout: string;
	stderr: string;
}

/** @public */
export interface TeamWorktreeRequest {
	/** Absolute path to the clean source checkout. */
	repoRoot: string;
	/** Absolute output directory outside repoRoot for isolated worktrees. */
	worktreeRoot: string;
	/** Team run identifier used in branch/path names. */
	runId: string;
	/** Worker/node identifier used in branch/path names. */
	workerId: string;
	/** Git ref to branch from. Defaults to HEAD. */
	baseRef?: string;
	/** Branch namespace. Defaults to pi-teams/worker. */
	branchPrefix?: string;
}

/** @public */
export interface TeamWorktreePlan {
	repoRoot: string;
	worktreeRoot: string;
	runId: string;
	workerId: string;
	baseRef: string;
	branchName: string;
	worktreePath: string;
	lockPath: string;
}

/** @public */
export interface TeamWorktreeCleanupResult {
	removedWorktree: boolean;
	removedBranch: boolean;
	removedLock: boolean;
}

/** @public */
export interface TeamWorktreeConflictReport {
	hasConflicts: boolean;
	files: string[];
	unavailable?: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

async function git(cwd: string, args: readonly string[]): Promise<ExecResult> {
	return execFileAsync("git", [...args], { cwd, maxBuffer: 1024 * 1024 });
}

function isWithin(parent: string, child: string): boolean {
	const normalizedParent = resolve(parent);
	const normalizedChild = resolve(child);
	return (
		normalizedChild === normalizedParent ||
		normalizedChild.startsWith(`${normalizedParent}${sep}`)
	);
}

function requireAbsolutePath(name: string, path: string): string {
	if (!path || !isAbsolute(path)) {
		throw new Error(`${name} must be an absolute path`);
	}
	return resolve(path);
}

function safeId(value: string, name: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error(`${name} is required`);
	}
	if (
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed.includes("..")
	) {
		throw new Error(`${name} must not contain path separators or traversal`);
	}
	const slug = trimmed
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug) {
		throw new Error(`${name} must contain at least one alphanumeric character`);
	}
	return slug.slice(0, 80);
}

function safeBranchPrefix(value: string | undefined): string {
	const raw = value?.trim() || DEFAULT_BRANCH_PREFIX;
	const segments = raw
		.split("/")
		.filter(Boolean)
		.map((segment) => safeId(segment, "branchPrefix"));
	if (segments.length === 0) {
		throw new Error("branchPrefix is required");
	}
	return segments.join("/");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function assertGitRepoRoot(repoRoot: string): Promise<void> {
	const result = await git(repoRoot, ["rev-parse", "--show-toplevel"]);
	if (resolve(result.stdout.trim()) !== repoRoot) {
		throw new Error(`repoRoot must be the git toplevel: ${repoRoot}`);
	}
}

async function assertCleanMainCheckout(repoRoot: string): Promise<void> {
	const result = await git(repoRoot, ["status", "--porcelain"]);
	if (result.stdout.trim()) {
		throw new Error(
			"main checkout must be clean before allocating a mutating team worktree",
		);
	}
}

async function acquireLock(lockPath: string): Promise<void> {
	try {
		await mkdir(lockPath);
	} catch (error) {
		if (isNodeError(error) && error.code === "EEXIST") {
			throw new Error(`worktree lock already exists: ${lockPath}`);
		}
		throw error;
	}
}

async function releaseLock(lockPath: string): Promise<boolean> {
	if (!(await pathExists(lockPath))) {
		return false;
	}
	await rm(lockPath, { recursive: true, force: true });
	return true;
}

/** Build deterministic branch, worktree, and lock paths without touching git. */
export function planTeamWorktree(
	request: TeamWorktreeRequest,
): TeamWorktreePlan {
	const repoRoot = requireAbsolutePath("repoRoot", request.repoRoot);
	const worktreeRoot = requireAbsolutePath(
		"worktreeRoot",
		request.worktreeRoot,
	);
	if (isWithin(repoRoot, worktreeRoot)) {
		throw new Error(
			"worktreeRoot must be outside repoRoot to avoid dirtying the main checkout",
		);
	}
	const runSlug = safeId(request.runId, "runId");
	const workerSlug = safeId(request.workerId, "workerId");
	const slug = `${runSlug}-${workerSlug}`;
	return {
		repoRoot,
		worktreeRoot,
		runId: runSlug,
		workerId: workerSlug,
		baseRef: request.baseRef?.trim() || "HEAD",
		branchName: `${safeBranchPrefix(request.branchPrefix)}/${slug}`,
		worktreePath: join(worktreeRoot, slug),
		lockPath: join(worktreeRoot, `${slug}.lock`),
	};
}

/**
 * Allocate an isolated git worktree for an opt-in mutating team worker.
 * This helper is not wired into team runtime; callers must opt in explicitly.
 */
export async function allocateTeamWorktree(
	request: TeamWorktreeRequest,
): Promise<TeamWorktreePlan> {
	const plan = planTeamWorktree(request);
	await assertGitRepoRoot(plan.repoRoot);
	await assertCleanMainCheckout(plan.repoRoot);
	await mkdir(plan.worktreeRoot, { recursive: true });
	if (await pathExists(plan.worktreePath)) {
		throw new Error(`worktree path already exists: ${plan.worktreePath}`);
	}
	await acquireLock(plan.lockPath);
	try {
		await git(plan.repoRoot, [
			"worktree",
			"add",
			"-b",
			plan.branchName,
			"--",
			plan.worktreePath,
			plan.baseRef,
		]);
		return plan;
	} catch (error) {
		await releaseLock(plan.lockPath);
		throw error;
	}
}

/** Remove the isolated worktree, its branch, and allocation lock as rollback cleanup. */
export async function cleanupTeamWorktree(
	plan: TeamWorktreePlan,
): Promise<TeamWorktreeCleanupResult> {
	let removedWorktree = false;
	let removedBranch = false;
	if (await pathExists(plan.worktreePath)) {
		await git(plan.repoRoot, [
			"worktree",
			"remove",
			"--force",
			"--",
			plan.worktreePath,
		]);
		removedWorktree = true;
	}
	try {
		await git(plan.repoRoot, ["branch", "-D", "--", plan.branchName]);
		removedBranch = true;
	} catch {
		// Branch may already be removed or may never have been created.
	}
	const removedLock = await releaseLock(plan.lockPath);
	return { removedWorktree, removedBranch, removedLock };
}

/** Report unmerged files in an allocated worktree without mutating either checkout. */
export async function inspectTeamWorktreeConflicts(
	plan: TeamWorktreePlan,
): Promise<TeamWorktreeConflictReport> {
	if (!(await pathExists(plan.worktreePath))) {
		return { hasConflicts: false, files: [], unavailable: "worktree missing" };
	}
	const result = await git(plan.worktreePath, [
		"diff",
		"--name-only",
		"--diff-filter=U",
	]);
	const files = result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return { hasConflicts: files.length > 0, files };
}

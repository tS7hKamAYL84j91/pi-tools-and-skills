import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	allocateTeamWorktree,
	cleanupTeamWorktree,
	inspectTeamWorktreeConflicts,
	planTeamWorktree,
	type TeamWorktreePlan,
} from "../extensions/pi-panopticon/teams/worktree-isolation.js";

const tempDirs: string[] = [];

function tempRoot(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(): string {
	const repo = tempRoot("pi-teams-worktree-repo-");
	git(repo, ["init", "--initial-branch=main"]);
	git(repo, ["config", "user.email", "test@example.com"]);
	git(repo, ["config", "user.name", "Test User"]);
	writeFileSync(join(repo, "README.md"), "# test\n", "utf8");
	git(repo, ["add", "README.md"]);
	git(repo, ["commit", "-m", "initial"]);
	return repo;
}

function status(repo: string): string {
	return git(repo, ["status", "--porcelain"]).trim();
}

async function cleanup(plan: TeamWorktreePlan | undefined): Promise<void> {
	if (plan) {
		await cleanupTeamWorktree(plan).catch(() => undefined);
	}
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("pi-teams worktree isolation planning", () => {
	it("creates deterministic branch, worktree, and lock paths", () => {
		const repo = join(tempRoot("repo-root-"), "repo");
		const worktrees = join(tempRoot("worktree-root-"), "worktrees");

		const plan = planTeamWorktree({
			repoRoot: repo,
			worktreeRoot: worktrees,
			runId: "Team Run 123",
			workerId: "Synthesis Worker",
		});

		expect(plan.branchName).toBe("pi-teams/worker/team-run-123-synthesis-worker");
		expect(plan.worktreePath).toBe(join(worktrees, "team-run-123-synthesis-worker"));
		expect(plan.lockPath).toBe(join(worktrees, "team-run-123-synthesis-worker.lock"));
		expect(plan.baseRef).toBe("HEAD");
	});

	it("rejects invalid path and id inputs", () => {
		const repoRoot = join(tempRoot("repo-root-"), "repo");
		const worktreeRoot = join(repoRoot, "worktrees");
		expect(() => planTeamWorktree({ repoRoot: "relative", worktreeRoot: tempRoot("worktree-root-"), runId: "run", workerId: "worker" })).toThrow(/repoRoot/);
		expect(() => planTeamWorktree({ repoRoot, worktreeRoot, runId: "run", workerId: "worker" })).toThrow(/outside repoRoot/);
		expect(() => planTeamWorktree({ repoRoot, worktreeRoot: tempRoot("worktree-root-"), runId: "../run", workerId: "worker" })).toThrow(/runId/);
		expect(() => planTeamWorktree({ repoRoot, worktreeRoot: tempRoot("worktree-root-"), runId: "run", workerId: "" })).toThrow(/workerId/);
	});
});

describe("pi-teams worktree isolation lifecycle", () => {
	it("allocates and cleans up a worktree without dirtying the main checkout", async () => {
		const repo = initRepo();
		const worktreeRoot = tempRoot("pi-teams-worktrees-");
		let plan: TeamWorktreePlan | undefined;
		try {
			plan = await allocateTeamWorktree({ repoRoot: repo, worktreeRoot, runId: "run-1", workerId: "worker-1" });
			expect(existsSync(plan.worktreePath)).toBe(true);
			expect(existsSync(plan.lockPath)).toBe(true);

			writeFileSync(join(plan.worktreePath, "worker-output.md"), "isolated output\n", "utf8");

			expect(status(repo)).toBe("");
		} finally {
			await cleanup(plan);
		}
		expect(plan ? existsSync(plan.worktreePath) : false).toBe(false);
		expect(plan ? existsSync(plan.lockPath) : false).toBe(false);
		expect(status(repo)).toBe("");
	});

	it("rejects allocation when the main checkout is dirty", async () => {
		const repo = initRepo();
		writeFileSync(join(repo, "dirty.txt"), "dirty\n", "utf8");

		await expect(allocateTeamWorktree({
			repoRoot: repo,
			worktreeRoot: tempRoot("pi-teams-worktrees-"),
			runId: "run-2",
			workerId: "worker-2",
		})).rejects.toThrow(/main checkout must be clean/);
	});

	it("rejects collision locks and leaves existing locks in place", async () => {
		const repo = initRepo();
		const worktreeRoot = tempRoot("pi-teams-worktrees-");
		const plan = planTeamWorktree({ repoRoot: repo, worktreeRoot, runId: "run-3", workerId: "worker-3" });
		mkdirSync(worktreeRoot, { recursive: true });
		mkdirSync(plan.lockPath);

		await expect(allocateTeamWorktree({ repoRoot: repo, worktreeRoot, runId: "run-3", workerId: "worker-3" })).rejects.toThrow(/lock already exists/);
		expect(existsSync(plan.lockPath)).toBe(true);
	});

	it("reports unmerged conflicts in an isolated worktree", async () => {
		const repo = initRepo();
		writeFileSync(join(repo, "conflict.txt"), "base\n", "utf8");
		git(repo, ["add", "conflict.txt"]);
		git(repo, ["commit", "-m", "base conflict file"]);
		git(repo, ["checkout", "-b", "other"]);
		writeFileSync(join(repo, "conflict.txt"), "other\n", "utf8");
		git(repo, ["commit", "-am", "other change"]);
		git(repo, ["checkout", "-"]);

		let plan: TeamWorktreePlan | undefined;
		try {
			plan = await allocateTeamWorktree({ repoRoot: repo, worktreeRoot: tempRoot("pi-teams-worktrees-"), runId: "run-4", workerId: "worker-4" });
			writeFileSync(join(plan.worktreePath, "conflict.txt"), "worker\n", "utf8");
			git(plan.worktreePath, ["commit", "-am", "worker change"]);
			try {
				git(plan.worktreePath, ["merge", "other"]);
			} catch {
				// Expected conflict.
			}

			await expect(inspectTeamWorktreeConflicts(plan)).resolves.toEqual({
				hasConflicts: true,
				files: ["conflict.txt"],
			});
			expect(status(repo)).toBe("");
		} finally {
			await cleanup(plan);
		}
	});
});

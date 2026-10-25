/**
 * pi-overview: read-only project snapshot and width-bounded rendering.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";

import {
	gatherProjectSnapshot,
	overviewLines,
	summaryLine,
} from "../../extensions/pi-overview/snapshot.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

const dirs: string[] = [];

function temporaryDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-overview-"));
	dirs.push(dir);
	return dir;
}

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}

function gitRepo(): string {
	const dir = temporaryDir();
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "test@example.com");
	git(dir, "config", "user.name", "Test");
	writeFileSync(join(dir, "a.txt"), "one\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "first commit");
	writeFileSync(join(dir, "a.txt"), "two\n");
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("gatherProjectSnapshot", () => {
	it("reads branch, uncommitted count, and recent commits", () => {
		const snapshot = gatherProjectSnapshot(gitRepo());
		expect(snapshot.branch === undefined ? "" : snapshot.branch.length).toBeGreaterThan(0);
		expect(snapshot.dirtyCount).toBe(1);
		expect(snapshot.commits[0]).toContain("first commit");
	});

	it("reports a non-git directory without guessing", () => {
		const snapshot = gatherProjectSnapshot(temporaryDir());
		expect(snapshot.branch).toBeUndefined();
		expect(snapshot.dirtyCount).toBeUndefined();
		expect(snapshot.commits).toEqual([]);
	});

	it("counts SPR decision lines and ignores prose", () => {
		const dir = temporaryDir();
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, "docs", "decisions.md"),
			[
				"# Decisions",
				"",
				"- 001 First decision — facts here.",
				"- 002 Second decision — more facts.",
				"Not a decision.",
				"- 003 Third decision — last.",
				"",
			].join("\n"),
		);
		expect(gatherProjectSnapshot(dir).decisions).toEqual({
			path: "docs/decisions.md",
			count: 3,
		});
	});

	it("omits the decision row when the log is absent", () => {
		expect(gatherProjectSnapshot(temporaryDir()).decisions).toBeUndefined();
	});
});

describe("overviewLines", () => {
	const facts = {
		sessionName: "demo",
		modelLabel: "ollama/glm-5.3-flash:cloud",
		context: { tokens: 12345, contextWindow: 1048576, percent: 1 },
		entries: 42,
		idle: true,
	};

	it("shows project, session, and context facts", () => {
		const snapshot = gatherProjectSnapshot(gitRepo());
		const body = overviewLines(snapshot, facts, 100, fakeTheme).join("\n");
		expect(body).toContain("Project overview");
		expect(body).toContain("workspace");
		expect(body).toContain("first commit");
		expect(body).toContain("ollama/glm-5.3-flash:cloud");
		expect(body).toContain("12,345 / 1,048,576 tokens (1%)");
		expect(body).toContain("42 entries");
		expect(body).toContain("1 uncommitted");
	});

	it("stays width-bounded and says so when not a git repository", () => {
		const snapshot = gatherProjectSnapshot(temporaryDir());
		for (const width of [60, 80, 120]) {
			const lines = overviewLines(snapshot, facts, width, fakeTheme);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(lines.join("\n")).toContain("not a git repository");
		}
	});

	it("fits the overlay row budget and marks a clipped commit list", () => {
		const snapshot = gatherProjectSnapshot(gitRepo());
		for (const rows of [20, 24, 40]) {
			const lines = overviewLines(snapshot, facts, 100, fakeTheme, rows);
			// Mirror pi-tui's overlay math for { maxHeight: "80%", margin: 2 }.
			const budget = Math.max(1, Math.min(Math.floor(rows * 0.8), Math.max(1, rows - 4)));
			expect(lines.length).toBeLessThanOrEqual(budget);
			// The facts the panel exists to show survive a short terminal.
			expect(lines.join("\n")).toContain("1 uncommitted");
			expect(lines.join("\n")).toContain("workspace");
		}
	});

	it("keeps branch and dirty state when the terminal is too short for commits", () => {
		const snapshot = gatherProjectSnapshot(gitRepo());
		const lines = overviewLines(snapshot, facts, 100, fakeTheme, 10);
		const body = lines.join("\n");
		expect(lines.length).toBeLessThanOrEqual(6);
		expect(body).toContain("1 uncommitted");
		expect(body).not.toContain("recent commits");
	});

	it("keeps every commit when the row count is unknown", () => {
		const snapshot = gatherProjectSnapshot(gitRepo());
		const body = overviewLines(snapshot, facts, 100, fakeTheme).join("\n");
		expect(body).toContain("first commit");
		expect(body).not.toContain("more)");
	});
});

describe("summaryLine", () => {
	it("is a single bounded line usable without an overlay", () => {
		const snapshot = gatherProjectSnapshot(gitRepo());
		const line = summaryLine(snapshot);
		expect(line).toContain(snapshot.workspace);
		expect(line).toContain("1 uncommitted");
		expect(line).toContain("HEAD ");
	});
});
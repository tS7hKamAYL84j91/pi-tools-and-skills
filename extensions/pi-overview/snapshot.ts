/**
 * Read-only project snapshot for the /overview panel.
 *
 * Everything here is observation: fixed git commands (no user input), a
 * bounded read of the decision log, and no writes. Rendering is pure so it can
 * be tested without a terminal.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

interface DecisionSummary {
	path: string;
	count: number;
}

export interface ProjectSnapshot {
	workspace: string;
	branch?: string;
	dirtyCount?: number;
	commits: string[];
	decisions?: DecisionSummary;
}

export interface OverviewFacts {
	sessionName?: string;
	modelLabel?: string;
	context?: { tokens: number | null; contextWindow: number; percent: number | null };
	entries: number;
	idle: boolean;
}

/** Fixed-argument git call; returns undefined for a non-repo or a failed command. */
function git(cwd: string, args: string[]): string | undefined {
	try {
		const out = execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out.length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
}

const DECISIONS_MAX_BYTES = 1024 * 1024;

/** Count SPR decision lines (`- NNN Title — facts`) in the project decision log. */
function readDecisions(cwd: string): DecisionSummary | undefined {
	const path = join(cwd, "docs", "decisions.md");
	try {
		if (!existsSync(path) || statSync(path).size > DECISIONS_MAX_BYTES) return undefined;
		const count = readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => /^-\s+\d{3}\s+\S/.test(line)).length;
		return { path: "docs/decisions.md", count };
	} catch {
		return undefined;
	}
}

export function gatherProjectSnapshot(cwd: string): ProjectSnapshot {
	const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const status = git(cwd, ["status", "--porcelain"]);
	const log = git(cwd, ["log", "--oneline", "-6"]);
	const decisions = readDecisions(cwd);
	return {
		workspace: cwd,
		...(branch === undefined ? {} : { branch }),
		...(status === undefined
			? {}
			: { dirtyCount: status.split("\n").filter((line) => line.trim().length > 0).length }),
		commits: log === undefined ? [] : log.split("\n"),
		...(decisions === undefined ? {} : { decisions }),
	};
}

/** One-line summary for notifications where no overlay is available. */
export function summaryLine(snapshot: ProjectSnapshot): string {
	const parts = [snapshot.workspace];
	if (snapshot.branch !== undefined) parts.push(snapshot.branch);
	if (snapshot.dirtyCount !== undefined && snapshot.dirtyCount > 0) {
		parts.push(`${snapshot.dirtyCount} uncommitted`);
	}
	if (snapshot.commits[0] !== undefined) parts.push(`HEAD ${snapshot.commits[0]}`);
	return parts.join(" · ");
}

function formatTokens(value: number): string {
	return value.toLocaleString("en-GB");
}

/**
 * Rows pi-tui will actually paint for the overlay options used here
 * ({ maxHeight: "80%", margin: 2 }). Unknown rows (non-TUI hosts, test fakes)
 * keep the unbounded legacy render.
 */
function overlayLineBudget(rows: number | undefined): number | undefined {
	if (rows === undefined) return undefined;
	return Math.max(1, Math.min(Math.floor(rows * 0.8), Math.max(1, rows - 4)));
}

/** Pure renderer: width-bounded lines for the overlay. */
export function overviewLines(
	snapshot: ProjectSnapshot,
	facts: OverviewFacts,
	width: number,
	theme: Theme,
	rows?: number,
): string[] {
	const lines: string[] = [];
	const row = (label: string, value: string): void => {
		lines.push(truncateToWidth(`  ${theme.fg("dim", label.padEnd(11))} ${value}`, width));
	};

	lines.push(truncateToWidth(theme.fg("accent", theme.bold(" Project overview")), width));
	lines.push("");
	row("workspace", snapshot.workspace);

	if (snapshot.branch === undefined) {
		row("branch", theme.fg("dim", "not a git repository"));
	} else {
		const dirty =
			snapshot.dirtyCount === undefined
				? ""
				: snapshot.dirtyCount === 0
					? theme.fg("dim", " · clean")
					: theme.fg("warning", ` · ${snapshot.dirtyCount} uncommitted`);
		row("branch", `${snapshot.branch}${dirty}`);
	}

	const session = [facts.sessionName ?? "unnamed", facts.modelLabel ?? "?", facts.idle ? "idle" : "running"];
	row("session", session.join(" · "));
	if (facts.context !== undefined) {
		const { tokens, contextWindow, percent } = facts.context;
		const used = tokens === null ? "—" : formatTokens(tokens);
		const pct = percent === null ? "" : ` (${percent}%)`;
		row("context", `${used} / ${formatTokens(contextWindow)} tokens${pct}`);
	}
	row("transcript", `${facts.entries} entries`);
	if (snapshot.decisions !== undefined) {
		row("decisions", `${snapshot.decisions.count} in ${snapshot.decisions.path}`);
	}

	const budget = overlayLineBudget(rows);
	const hint = truncateToWidth(theme.fg("dim", " esc/q/enter close"), width);
	// Everything above the commit list is the reason the panel exists (branch and
	// dirty state first). Only commits and the hint may yield to a short terminal.
	const coreLines = lines.length;
	const hintFits = budget === undefined || coreLines + 4 <= budget;
	const reserved = (budget === undefined ? Number.POSITIVE_INFINITY : budget) - coreLines - (hintFits ? 2 : 0);
	const commitBudget = reserved - 2; // blank + "recent commits" header

	if (budget === undefined || commitBudget >= 1) {
		lines.push("");
		lines.push(truncateToWidth(theme.fg("dim", " recent commits"), width));
		if (snapshot.commits.length === 0) {
			lines.push(truncateToWidth(theme.fg("dim", "  (none)"), width));
		} else if (snapshot.commits.length <= commitBudget) {
			for (const commit of snapshot.commits) {
				lines.push(truncateToWidth(`  ${commit}`, width));
			}
		} else {
			// Leave one line for the count so a clipped list never looks complete.
			const shown = Math.max(0, commitBudget - 1);
			for (const commit of snapshot.commits.slice(0, shown)) {
				lines.push(truncateToWidth(`  ${commit}`, width));
			}
			lines.push(truncateToWidth(theme.fg("dim", `  …(+${snapshot.commits.length - shown} more)`), width));
		}
	}
	if (hintFits) {
		lines.push("");
		lines.push(hint);
	}
	// Safety net: pi-tui drops lines past maxHeight silently, so never exceed it.
	return budget === undefined ? lines : lines.slice(0, budget);
}
/** Fleet registry: known agents, their repos/session dirs — mirror of
 * eo_fleet/config.py for the surfaces the TS host still needs (usage,
 * events, board, schedules, brief). Fleet liveness itself stays
 * agent-registry-driven (the TS host's deliberate design). */

import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HOME = homedir();
export const SESSIONS_ROOT = join(HOME, ".pi", "agent", "sessions");

// Runtime home: directives/, control/, cache/ live in the source tree so a
// rebuild (dist/ is wiped) never loses inbox, audit, or cache data. When the
// process runs from dist/, resolve back to the source dir; Q can pin
// FLEET_OVERVIEW_HOME in the unit file for a dedicated runtime location.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FROM_DIST = basename(dirname(MODULE_DIR)) === "dist";
export const FLEET_HOME =
	process.env.FLEET_OVERVIEW_HOME ??
	(FROM_DIST
		? join(dirname(dirname(MODULE_DIR)), "fleet-overview")
		: MODULE_DIR);

// Repos whose ledgers/schedules/board we surface (read-only).
export const REPOS: Readonly<Record<string, string>> = {
	"chief-of-staff": join(
		HOME,
		"git",
		"working-notes",
		"executive-office",
		"chief-of-staff",
	),
	"kaggle-enveda-casmi26": join(HOME, "git", "kaggle-enveda-casmi26"),
	"kaggle-spaceship-titanic": join(HOME, "git", "kaggle-spaceship-titanic"),
	coas: join(HOME, "git", "coas"),
};

export interface AgentSpec {
	readonly key: string;
	/** nice name */
	readonly display: string;
	/** basename under SESSIONS_ROOT ("" = no live session expected) */
	readonly sessionDir: string;
	/** e.g. stood-down marker */
	readonly statusNote: string;
}

// Live agents (fleet membership is Jim's decision; dashboard is read-only).
export const AGENTS: readonly AgentSpec[] = [
	{
		key: "gravitas",
		display: "Gravitas (chief-of-staff)",
		sessionDir:
			"--home-jim-git-working-notes-executive-office-chief-of-staff--",
		statusNote: "",
	},
	{
		key: "coas",
		display: "Q (coas)",
		sessionDir: "--home-jim-git-coas--",
		statusNote: "",
	},
	{
		key: "pi-tools-and-skills",
		display: "pi-tools-and-skills",
		sessionDir: "--home-jim-git-pi-tools-and-skills--",
		statusNote: "",
	},
	{
		key: "casmi-gm",
		display: "casmi-gm (enveda CASMI26)",
		sessionDir: "--home-jim-git-kaggle-enveda-casmi26--",
		statusNote: "",
	},
];

// Stood-down / historical agents: excluded from the live Fleet tab, kept in
// usage history. 2026-09-16: titanic-gm stood down by Jim.
export const HISTORICAL: readonly AgentSpec[] = [
	{
		key: "titanic-gm",
		display: "titanic-gm (stood down)",
		sessionDir: "--home-jim-git-kaggle-spaceship-titanic--",
		statusNote: "stood down 2026-09-16",
	},
];

// Ledger files surfaced in the event feed (label -> path).
export const LEDGERS: readonly (readonly [string, string])[] = [
	[
		"casmi26",
		join(REPOS["kaggle-enveda-casmi26"] ?? "", "experiments", "ledger.jsonl"),
	],
	[
		"titanic",
		join(
			REPOS["kaggle-spaceship-titanic"] ?? "",
			"experiments",
			"ledger.jsonl",
		),
	],
];

// Schedules surfaced (repo -> schedules dir).
export const SCHEDULE_DIRS: Readonly<Record<string, string>> =
	Object.fromEntries(
		Object.entries(REPOS).map(([repo, path]) => [
			repo,
			join(path, ".pi", "automations", "schedules"),
		]),
	);

export const KANBAN_DIR = join(REPOS["chief-of-staff"] ?? "", "pi-kanban");

/**
 * awaiting.json is maintained by Gravitas (read-only to the dashboard). It
 * lives in the Python host repo today; `FLEET_AWAITING_PATH` lets Q/Gravitas
 * relocate it when that repo retires.
 */
export const AWAITING_PATH =
	process.env.FLEET_AWAITING_PATH ??
	join(HOME, "git", "eo-fleet-overview", "awaiting.json");

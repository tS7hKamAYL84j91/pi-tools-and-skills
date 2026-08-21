/**
 * Project built-in team seeds into the user scope on startup.
 *
 * Built-in team specs ship at `config/teams/*.md` as immutable packaged
 * defaults. On `session_start(startup)` they are projected verbatim into the
 * user team directory (`~/.pi/agent/teams` by default, or the configured
 * `teams.roots` user root) so the live copy becomes the editable source of
 * truth for that team. Projection is idempotent and never overwrites an
 * existing user file unless `force` is set (the explicit `/teams seed --force`
 * escape hatch). See `docs/adr/026-project-built-in-teams-into-user-scope.md`.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { DEFAULT_CONFIG_JSON, dirsForTeamScope, teamDirectories } from "./team-paths.js";

/** Index of the builtin source within `teamDirectories()` output. */
const BUILTIN_SOURCE_INDEX = 0;

/** @public */
export interface ProjectionResult {
	/** Team ids newly written to the user scope. */
	readonly projected: readonly string[];
	/** Team ids that already existed and were left untouched. */
	readonly skipped: readonly string[];
	/** Team ids overwritten because `force` was set. */
	readonly overwritten: readonly string[];
}

interface ProjectOptions {
	/** Overwrite existing user-scope files for built-in ids. */
	readonly force?: boolean;
	/** Override the builtin seed source (defaults to the packaged config). */
	readonly configPath?: string;
	/** Override the destination user team directory (defaults to the resolved user scope). */
	readonly userTeamsDir?: string;
}

interface BuiltinTeamFile {
	readonly id: string;
	readonly path: string;
	readonly raw: string;
}

/**
 * Markdown comment marker prepended to the body of a projected file so users
 * can see it is a seed copy they own. An HTML comment is invisible in rendered
 * markdown and does not affect front-matter parsing.
 */
function seedMarker(id: string): string {
	return `<!-- pi-teams seed projection of "${id}". This file is the source of truth for this team; edit it freely. Re-project missing seeds with /teams seed. -->`;
}

function legacySeedMarker(id: string): string {
	return `<!-- pi-panopticon seed projection of "${id}". This file is the source of truth for this team; edit it freely. Re-project missing seeds with /teams seed. -->`;
}

/**
 * Insert the seed marker immediately after the front-matter closing fence,
 * preserving the rest of the file verbatim. Files without valid front matter
 * are returned unchanged.
 */
function withSeedMarker(raw: string, id: string): string {
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return raw;
	const end = normalized.indexOf("\n---\n", 4);
	if (end < 0) return raw;
	const before = normalized.slice(0, end + "\n---\n".length);
	const after = normalized.slice(end + "\n---\n".length);
	return `${before}\n${seedMarker(id)}\n\n${after}`;
}

function builtinTeamFiles(configPath: string = DEFAULT_CONFIG_JSON): BuiltinTeamFile[] {
	const dirs = teamDirectories(configPath, { roots: [] });
	const builtin = dirs[BUILTIN_SOURCE_INDEX];
	if (!builtin || !existsSync(builtin.teams)) return [];
	return readdirSync(builtin.teams)
		.filter((file) => file.endsWith(".md"))
		.sort()
		.map((file) => {
			const path = join(builtin.teams, file);
			return { id: file.slice(0, -".md".length), path, raw: readFileSync(path, "utf8") };
		});
}

/**
 * Prune user-scope team files whose ids are no longer present in the
 * built-in seed set. Returns the list of removed ids. Safe to call repeatedly:
 * idsempotent and limited to the user scope.
 */
export async function pruneBuiltinTeams(ctx: ExtensionContext, options: ProjectOptions = {}): Promise<{ readonly removed: readonly string[] }> {
	const destTeamsDir = options.userTeamsDir ?? dirsForTeamScope("user", ctx.cwd).teams;
	const seeds = builtinTeamFiles(options.configPath);
	const seedIds = new Set(seeds.map((seed) => seed.id));
	const removed: string[] = [];
	if (!existsSync(destTeamsDir)) return { removed };
	for (const file of readdirSync(destTeamsDir)) {
		if (!file.endsWith(".md")) continue;
		const id = file.slice(0, -".md".length);
		if (seedIds.has(id)) continue;
		const target = join(destTeamsDir, file);
		// Only prune files that were seeded by us (marker present). Custom user teams are preserved.
		if (!existsSync(target)) continue;
		const raw = readFileSync(target, "utf8");
		if (!raw.includes(seedMarker(id)) && !raw.includes(legacySeedMarker(id))) continue;
		unlinkSync(target);
		removed.push(id);
	}
	return { removed };
}

/**
 * Project built-in team seeds into the user scope. Idempotent and
 * non-destructive by default: only missing files are written. With
 * `options.force`, existing user-scope files for built-in ids are overwritten
 * (used by the explicit `/teams seed --force` reset path). Writes go through
 * the shared `writeFileAtomic` helper (same-directory temp + rename).
 */
export async function projectBuiltinTeams(ctx: ExtensionContext, options: ProjectOptions = {}): Promise<ProjectionResult> {
	const destTeamsDir = options.userTeamsDir ?? dirsForTeamScope("user", ctx.cwd).teams;
	const seeds = builtinTeamFiles(options.configPath);
	const projected: string[] = [];
	const skipped: string[] = [];
	const overwritten: string[] = [];
	if (seeds.length === 0) return { projected, skipped, overwritten };
	for (const seed of seeds) {
		const target = join(destTeamsDir, `${seed.id}.md`);
		const exists = existsSync(target);
		if (exists && !options.force) {
			skipped.push(seed.id);
			continue;
		}
		await writeFileAtomic(target, withSeedMarker(seed.raw, seed.id));
		if (exists) overwritten.push(seed.id);
		else projected.push(seed.id);
	}
	return { projected, skipped, overwritten };
}
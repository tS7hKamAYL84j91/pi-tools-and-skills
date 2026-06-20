/**
 * Tests for built-in team seed projection (ADR 026).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectBuiltinTeams } from "../../extensions/pi-panopticon/teams/team-projection.js";

const BUILTIN_IDS = ["deep-research", "llm-council", "navigator", "router-fusion"];

function fakeCtx(cwd: string): ExtensionContext {
	return { cwd } as unknown as ExtensionContext;
}

let dest: string;

beforeEach(() => {
	dest = mkdtempSync(join(tmpdir(), "team-proj-dest-"));
});

afterEach(() => {
	rmSync(dest, { recursive: true, force: true });
});

describe("projectBuiltinTeams", () => {
	it("projects all built-in seeds verbatim into the user dir with a seed marker", async () => {
		const result = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect([...result.projected].sort()).toEqual(BUILTIN_IDS);
		expect(result.skipped).toEqual([]);
		expect(result.overwritten).toEqual([]);

		const council = readFileSync(join(dest, "llm-council.md"), "utf8");
		// Front matter preserved verbatim, including pinned models (no stripping).
		expect(council.startsWith("---\n")).toBe(true);
		expect(council).toContain('model: "ollama/qwen3.5:cloud"');
		// Seed marker inserted as an invisible HTML comment in the body.
		expect(council).toContain('<!-- pi-panopticon seed projection of "llm-council"');
	});

	it("does not overwrite an existing user file (preexisting edit preserved)", async () => {
		writeFileSync(
			join(dest, "navigator.md"),
			'---\nschemaVersion: 2\nid: "navigator"\nprotocol: "consult"\nagents:\n  - role: "navigator"\n    subagent: "consult_navigator"\n    model: "my/custom-edit"\n---\nmy custom body\n',
			"utf8",
		);

		const result = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect(result.skipped).toContain("navigator");
		expect([...result.projected].sort()).toEqual(["deep-research", "llm-council", "router-fusion"]);
		const nav = readFileSync(join(dest, "navigator.md"), "utf8");
		expect(nav).toContain("my/custom-edit");
		expect(nav).not.toContain("seed projection");
	});

	it("is idempotent (a second call skips everything and writes nothing)", async () => {
		await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });
		const before = readdirSync(dest).sort();

		const second = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect(second.projected).toEqual([]);
		expect([...second.skipped].sort()).toEqual(BUILTIN_IDS);
		expect(readdirSync(dest).sort()).toEqual(before);
	});

	it("force overwrites existing user files for built-in ids", async () => {
		writeFileSync(join(dest, "navigator.md"), "CUSTOM", "utf8");

		const result = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest, force: true });

		expect(result.overwritten).toContain("navigator");
		expect([...result.projected].sort()).toEqual(["deep-research", "llm-council", "router-fusion"]);
		const nav = readFileSync(join(dest, "navigator.md"), "utf8");
		expect(nav).not.toContain("CUSTOM");
		expect(nav).toContain("seed projection");
	});

	it("returns an empty manifest when there are no built-in seeds", async () => {
		const result = await projectBuiltinTeams(fakeCtx(dest), {
			userTeamsDir: dest,
			configPath: join(dest, "missing-config.json"),
		});

		expect(result.projected).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(existsSync(join(dest, "teams"))).toBe(false);
	});
});
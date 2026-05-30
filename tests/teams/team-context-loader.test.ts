import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadTeamContext } from "../../extensions/pi-panopticon/teams/context-loader.js";

let root: string;
let cwd: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "team-ctx-"));
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, ".git")); // marks project root
	writeFileSync(join(root, "package.json"), "{}");
	cwd = join(root, "src");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("loadTeamContext", () => {
	it("walks up to find the project root by .git or package.json", () => {
		const ctx = loadTeamContext({ cwd });
		expect(ctx.projectRoot).toBe(root);
	});

	it("loads AGENTS.md when present", () => {
		writeFileSync(join(root, "AGENTS.md"), "# rules\nbe terse");
		const ctx = loadTeamContext({ cwd });
		expect(ctx.instructions).toContain("be terse");
		expect(ctx.loaded.find((l) => l.kind === "instructions")?.path).toBe(join(root, "AGENTS.md"));
	});

	it("falls back to spec.md then docs/spec.md", () => {
		mkdirSync(join(root, "docs"));
		writeFileSync(join(root, "docs", "spec.md"), "doc spec body");
		const ctx = loadTeamContext({ cwd });
		expect(ctx.spec).toBe("doc spec body");
	});

	it("warns when no spec is found and no specPath provided", () => {
		const ctx = loadTeamContext({ cwd });
		expect(ctx.spec).toBeUndefined();
		expect(ctx.warnings.some((w) => /spec/i.test(w))).toBe(true);
	});

	it("loads explicit files relative to cwd or project root", () => {
		writeFileSync(join(cwd, "task.txt"), "do the thing");
		const ctx = loadTeamContext({ cwd, files: ["task.txt"] });
		expect(ctx.files).toHaveLength(1);
		expect(ctx.files[0]?.content).toBe("do the thing");
	});

	it("skips obvious secret files with a warning", () => {
		writeFileSync(join(root, ".env"), "API_KEY=secret");
		const ctx = loadTeamContext({ cwd, files: [".env"] });
		expect(ctx.files).toHaveLength(0);
		expect(ctx.warnings.some((w) => /secret/i.test(w))).toBe(true);
	});

	it("warns about missing files but does not throw", () => {
		const ctx = loadTeamContext({ cwd, files: ["nope.txt"] });
		expect(ctx.files).toHaveLength(0);
		expect(ctx.warnings.some((w) => /not found/i.test(w))).toBe(true);
	});
});

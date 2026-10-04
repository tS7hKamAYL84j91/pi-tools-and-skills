import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/check-package-imports.mjs");
describe("checkout package import smoke", () => {
	it("resolves root and standalone Teams in an isolated checkout without running hooks", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-package-imports-"));
		try {
			for (const path of ["extensions", "lib", "package.json"]) cpSync(resolve(path), join(root, path), { recursive: true });
			symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
			for (const dir of [root, join(root, "extensions/pi-team-workflows")]) {
				expect(execFileSync(process.execPath, [script, dir], { encoding: "utf8" })).toContain("Package imports resolved:");
			}
			writeFileSync(join(root, "extensions/pi-team-workflows/index.ts"), 'import "../../lib/missing-smoke-module.js";');
			expect(() => execFileSync(process.execPath, [script, join(root, "extensions/pi-team-workflows")], { stdio: "pipe" })).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

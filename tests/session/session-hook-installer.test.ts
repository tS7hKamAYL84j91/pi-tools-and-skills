import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manageSessionSpoolHook, validateSessionHookConfig } from "../../lib/session-hook-installer.js";

describe("session spool hook installer", () => {
	it("rejects missing implicit default and relative registry dirs", async () => {
		await expect(validateSessionHookConfig({ registryDir: "" })).rejects.toThrow(/required/);
		await expect(validateSessionHookConfig({ registryDir: "relative/path" })).rejects.toThrow(/absolute/);
	});

	it("rejects symlink registry dirs and invalid retention", async () => {
		const base = mkdtempSync(join(tmpdir(), "session-hook-base-"));
		const target = mkdtempSync(join(tmpdir(), "session-hook-target-"));
		const link = join(base, "link");
		symlinkSync(target, link);

		await expect(validateSessionHookConfig({ registryDir: link })).rejects.toThrow(/symlink/);
		await expect(validateSessionHookConfig({ registryDir: target, retentionEvents: 101 })).rejects.toThrow(/retentionEvents/);
	});

	it("supports idempotent dry-run, install, status, and uninstall", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-hook-"));

		const dryRun = await manageSessionSpoolHook("dry-run", { registryDir, retentionEvents: 12 });
		expect(dryRun).toMatchObject({ action: "dry-run", installed: false, changed: false, state: { retentionEvents: 12 } });
		expect(existsSync(dryRun.hookPath)).toBe(false);

		const firstInstall = await manageSessionSpoolHook("install", { registryDir, retentionEvents: 12 });
		expect(firstInstall).toMatchObject({ installed: true, changed: true });
		expect(existsSync(firstInstall.hookPath)).toBe(true);

		const secondInstall = await manageSessionSpoolHook("install", { registryDir, retentionEvents: 12 });
		expect(secondInstall).toMatchObject({ installed: true, changed: false });

		const status = await manageSessionSpoolHook("status", { registryDir });
		expect(status).toMatchObject({ installed: true, changed: false, state: { posture: "local-private-input-redacted-output" } });

		const firstUninstall = await manageSessionSpoolHook("uninstall", { registryDir });
		expect(firstUninstall).toMatchObject({ installed: false, changed: true });
		expect(existsSync(firstUninstall.hookPath)).toBe(false);

		const secondUninstall = await manageSessionSpoolHook("uninstall", { registryDir });
		expect(secondUninstall).toMatchObject({ installed: false, changed: false });
	});
});

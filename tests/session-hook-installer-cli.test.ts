import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSessionHookInstallerCli } from "../lib/session-hook-installer-cli.js";

describe("session hook installer CLI adapter", () => {
	it("delegates install/status/uninstall to the library implementation", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-hook-cli-"));

		const installed = await runSessionHookInstallerCli(["install", "--registry-dir", registryDir, "--retention-events", "12"]);
		expect(installed).toMatchObject({ action: "install", installed: true, changed: true, state: { retentionEvents: 12 } });
		expect(existsSync(join(registryDir, "session-spool-hook.json"))).toBe(true);

		const status = await runSessionHookInstallerCli(["status", "--registry-dir", registryDir]);
		expect(status).toMatchObject({ action: "status", installed: true, changed: false });

		const uninstalled = await runSessionHookInstallerCli(["uninstall", "--registry-dir", registryDir]);
		expect(uninstalled).toMatchObject({ action: "uninstall", installed: false, changed: true });
		expect(existsSync(join(registryDir, "session-spool-hook.json"))).toBe(false);
	});

	it("keeps argument validation in the adapter thin", async () => {
		await expect(runSessionHookInstallerCli([])).rejects.toThrow(/Usage:/);
		await expect(runSessionHookInstallerCli(["install", "--registry-dir"])).rejects.toThrow(/Missing value/);
	});
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBoostDescriptorAdapter } from "../../extensions/pi-boost/boost-descriptor-adapter.js";

const NOW = 10_000;
function descriptor(enablementId: string): string {
	return JSON.stringify({
		schemaVersion: 1, enablementId, principalIssuerId: "principal", enabled: true,
		maximumYields: 1, expiresAt: 20_000, revision: 1,
		model: { key: "principalBoostLease", provider: "reviewed", id: "sol", family: "sol-ultra" },
	});
}

function resolve(configPath: string, cwd: string, settingsPath: string) {
	return createBoostDescriptorAdapter({ configPath, cwd, settingsPath, now: () => NOW }).resolve();
}

describe("Boost descriptor discovery", () => {
	it("selects the highest present fixed target before parsing", async () => {
		const root = mkdtempSync(join(tmpdir(), "boost-discovery-"));
		const builtin = join(root, "builtin", "boost.md");
		const user = join(root, "user", "boost.md");
		const settings = join(root, "settings.json");
		mkdirSync(join(root, "builtin"), { recursive: true });
		mkdirSync(join(root, "user"), { recursive: true });
		writeFileSync(builtin, descriptor("builtin"));
		writeFileSync(user, descriptor("user"));
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "user")] } }));
		const selected = await resolve(builtin, root, settings);
		expect(selected?.descriptor.enablementId).toBe("user");
		writeFileSync(user, "malformed");
		expect(await resolve(builtin, root, settings)).toBeUndefined();
	});

	it("denies a non-file effective target without lower fallback", async () => {
		const root = mkdtempSync(join(tmpdir(), "boost-discovery-"));
		const builtin = join(root, "builtin", "boost.md");
		const user = join(root, "user", "boost.md");
		const settings = join(root, "settings.json");
		mkdirSync(join(root, "builtin"), { recursive: true });
		mkdirSync(join(root, "user"), { recursive: true });
		writeFileSync(builtin, descriptor("builtin"));
		mkdirSync(user);
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "user")] } }));
		await expect(resolve(builtin, root, settings)).rejects.toThrow();
	});

	it("uses the installed descriptor path when the cwd is unrelated", async () => {
		const selected = await createBoostDescriptorAdapter({ cwd: "/tmp", now: () => NOW }).resolve();
		expect(selected?.source).toBe("builtin");
		expect(selected?.path).toMatch(/extensions[\\/]pi-boost[\\/]config[\\/]boost\.md$/);
	});

	it("denies duplicate targets in the effective layer without lower fallback", async () => {
		const root = mkdtempSync(join(tmpdir(), "boost-discovery-"));
		const builtin = join(root, "builtin", "boost.md");
		const user = join(root, "user", "boost.md");
		const settings = join(root, "settings.json");
		mkdirSync(join(root, "builtin"), { recursive: true });
		mkdirSync(join(root, "user"), { recursive: true });
		writeFileSync(builtin, descriptor("builtin"));
		writeFileSync(user, descriptor("user"));
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "user"), join(root, "user")] } }));
		expect(await resolve(builtin, root, settings)).toBeUndefined();
	});
});

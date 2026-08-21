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

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "boost-discovery-"));
	const builtin = join(root, "builtin", "boost.md");
	const user = join(root, "user", "boost.md");
	const project = join(root, ".pi", "boost", "boost.md");
	const settings = join(root, "settings.json");
	mkdirSync(join(root, "builtin"), { recursive: true });
	writeFileSync(builtin, descriptor("builtin"));
	return { root, builtin, user, project, settings };
}

describe("Boost descriptor discovery", () => {
	it("selects the highest present fixed target before parsing and never falls back after denial", async () => {
		const { root, builtin, user, settings } = fixture();
		mkdirSync(join(root, "user"));
		writeFileSync(user, descriptor("user"));
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "user")] } }));
		expect((await resolve(builtin, root, settings))?.descriptor.enablementId).toBe("user");
		writeFileSync(user, "malformed");
		expect(await resolve(builtin, root, settings)).toBeUndefined();
	});

	it("selects project over user and builtin, including when lower layers are valid", async () => {
		const { root, builtin, user, project, settings } = fixture();
		mkdirSync(join(root, "user"), { recursive: true });
		mkdirSync(join(root, ".pi", "boost"), { recursive: true });
		writeFileSync(user, descriptor("user"));
		writeFileSync(project, descriptor("project"));
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "user")] } }));
		writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ boost: { roots: [join(root, ".pi", "boost")] } }));
		const selected = await resolve(builtin, root, settings);
		expect(selected).toMatchObject({ source: "project", path: project, descriptor: { enablementId: "project" } });
	});

	it("denies duplicate effective targets and a non-file target without lower fallback", async () => {
		const { root, builtin, user, settings } = fixture();
		mkdirSync(join(root, "user"), { recursive: true });
		writeFileSync(user, descriptor("user"));
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "user"), join(root, "user")] } }));
		expect(await resolve(builtin, root, settings)).toBeUndefined();
		writeFileSync(settings, JSON.stringify({ boost: { roots: [join(root, "directory-target")] } }));
		mkdirSync(join(root, "directory-target", "boost.md"), { recursive: true });
		await expect(resolve(builtin, root, settings)).rejects.toThrow();
	});

	it("skips missing roots and targets, but retains repeated explicit roots as ambiguity", async () => {
		const { root, builtin } = fixture();
		expect((await createBoostDescriptorAdapter({ configPath: builtin, cwd: root, roots: [join(root, "missing")], now: () => NOW }).resolve())?.source).toBe("builtin");
		const userRoot = join(root, "explicit-user");
		mkdirSync(userRoot);
		writeFileSync(join(userRoot, "boost.md"), descriptor("explicit"));
		expect(await createBoostDescriptorAdapter({ configPath: builtin, cwd: root, roots: [userRoot, userRoot], now: () => NOW }).resolve()).toBeUndefined();
	});

	it("uses the installed descriptor path when the cwd is unrelated", async () => {
		const selected = await createBoostDescriptorAdapter({ cwd: "/tmp", now: () => NOW }).resolve();
		expect(selected?.source).toBe("builtin");
		expect(selected?.path).toMatch(/extensions[\\/]pi-boost[\\/]config[\\/]boost\.md$/);
	});
});

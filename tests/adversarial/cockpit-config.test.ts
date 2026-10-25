/**
 * Adversarial acceptance: pi-cockpit config boundary and session isolation.
 * Criteria source: pi-cockpit/README.md ("Run", "Keys", "What this does NOT do").
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildChildArgs, loadCockpitConfig, parseCockpitConfig } from "../../pi-cockpit/cockpit-config.js";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("cockpit config acceptance", () => {
	it("fails startup on unknown fields", () => {
		expect(() => parseCockpitConfig({ cwd: "/x", surprise: true })).toThrow(/unknown cockpit config fields/);
	});

	it("rejects non-object documents rather than coercing them", () => {
		expect(() => parseCockpitConfig([])).toThrow(/must be a JSON object/);
		expect(() => parseCockpitConfig("nope")).toThrow(/must be a JSON object/);
		expect(() => parseCockpitConfig(null)).toThrow(/must be a JSON object/);
	});

	it("rejects empty strings and non-string args", () => {
		expect(() => parseCockpitConfig({ cwd: "" })).toThrow(/non-empty string/);
		expect(() => parseCockpitConfig({ args: ["ok", 3] })).toThrow(/array of strings/);
	});

	it("keeps args mutually exclusive with provider/model", () => {
		expect(() => parseCockpitConfig({ args: ["--mode", "rpc"], model: "m" })).toThrow(/mutually exclusive/);
		expect(() => parseCockpitConfig({ args: ["--mode", "rpc"], provider: "p" })).toThrow(/mutually exclusive/);
	});

	it("reports unreadable or malformed files with the path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "adv-cockpit-"));
		dirs.push(dir);
		expect(() => loadCockpitConfig(join(dir, "absent.json"))).toThrow(/failed to read cockpit config/);
		const broken = join(dir, "broken.json");
		await writeFile(broken, "{nope");
		expect(() => loadCockpitConfig(broken)).toThrow(/failed to read cockpit config/);
	});

	it("isolates the child with --no-session unless a sessionDir is configured", () => {
		expect(buildChildArgs(parseCockpitConfig({}))).toEqual(["--mode", "rpc", "--no-session"]);
		const isolated = buildChildArgs(parseCockpitConfig({ sessionDir: "/tmp/s" }));
		expect(isolated).not.toContain("--no-session");
		expect(isolated).toEqual(["--mode", "rpc"]);
	});

	it("passes name/provider/model through without building a shell string", () => {
		const args = buildChildArgs(parseCockpitConfig({ name: "cockpit; rm -rf /", model: "$HOME" }));
		expect(args).toEqual(["--mode", "rpc", "--no-session", "--name", "cockpit; rm -rf /", "--model", "$HOME"]);
	});

	it("defers detach and draft survival explicitly, not silently", () => {
		// R28/J deferral: the limitation must be real AND documented, otherwise
		// "deferred" is indistinguishable from "forgotten".
		expect(() => parseCockpitConfig({ attach: "session-1" })).toThrow(/unknown cockpit config fields/);
		expect(() => parseCockpitConfig({ resumeSession: true })).toThrow(/unknown cockpit config fields/);
		for (const config of [{}, { sessionDir: "/tmp/s" }, { args: ["--mode", "rpc"] }]) {
			const args = buildChildArgs(parseCockpitConfig(config));
			expect(args.filter((arg) => /attach|resume|reconnect/i.test(arg))).toEqual([]);
		}

		const readme = readFileSync(new URL("../../pi-cockpit/README.md", import.meta.url), "utf8");
		expect(readme).toMatch(/no attach mode/i);
		expect(readme).toMatch(/persist drafts or resume a conversation across restarts/i);
	});
});

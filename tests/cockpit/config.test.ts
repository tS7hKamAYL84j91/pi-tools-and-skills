/**
 * Cockpit config tests: strict parsing and explicit session isolation.
 */
import { describe, expect, it } from "vitest";

import {
	buildChildArgs,
	parseCockpitConfig,
} from "../../pi-cockpit/cockpit-config.ts";

describe("cockpit config", () => {
	it("defaults to an isolated no-session RPC child", () => {
		expect(buildChildArgs(parseCockpitConfig({}))).toEqual(["--mode", "rpc", "--no-session"]);
	});

	it("passes an explicit session directory instead of --no-session", () => {
		const config = parseCockpitConfig({
			sessionDir: "/tmp/cockpit-sessions",
			name: "poc",
			provider: "ollama",
			model: "glm-5.3-flash:cloud",
			cwd: "/tmp/workspace",
		});
		expect(buildChildArgs(config)).toEqual([
			"--mode",
			"rpc",
			"--name",
			"poc",
			"--provider",
			"ollama",
			"--model",
			"glm-5.3-flash:cloud",
		]);
	});

	it("rejects unknown fields rather than guessing", () => {
		expect(() => parseCockpitConfig({ sessionDir: "/tmp/x", mystery: true })).toThrow(
			/unknown cockpit config fields: mystery/,
		);
	});

	it("rejects empty strings and non-string args", () => {
		expect(() => parseCockpitConfig({ cwd: "" })).toThrow(/must be a non-empty string/);
		expect(() => parseCockpitConfig({ args: ["ok", 7] })).toThrow(/array of strings/);
	});

	it("rejects an args override combined with provider or model", () => {
		expect(() => parseCockpitConfig({ args: ["--mode", "rpc"], model: "x/y" })).toThrow(
			/mutually exclusive/,
		);
	});

	it("uses the verbatim args override when provided (fake child mode)", () => {
		const config = parseCockpitConfig({ args: ["--fake"] });
		expect(buildChildArgs(config)).toEqual(["--fake"]);
	});
});
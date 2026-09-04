/** Tests for pi-event-loop configuration parsing and validation (SPEC §6, §18). */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import {
	configText,
	fixtureObject,
} from "../../../tests/fixtures/pi-event-loop.js";
import {
	CONFIG_RELATIVE_PATH,
	loadEventLoopConfig,
	parseEventLoopConfig,
} from "../config.js";

describe("pi-event-loop configuration", () => {
	it("exports the documented configuration path", () => {
		expect(CONFIG_RELATIVE_PATH).toBe(".pi/event-loop.json");
	});

	it("accepts the SPEC example profile with defaults applied", () => {
		const result = parseEventLoopConfig(configText());
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		const config = result.config;
		expect(config?.version).toBe(1);
		expect(config?.activeProfile).toBe("default");
		expect(config?.limits.maxChainDepth).toBe(12);
		expect(
			config?.profiles["default"]?.events["work.completed"]?.allowAgentEmit,
		).toBe(true);
	});

	it("defaults limits when the limits block is omitted", () => {
		const raw = JSON.parse(configText()) as Record<string, unknown>;
		delete raw["limits"];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(true);
		expect(result.config?.limits.maxPendingCommands).toBe(20);
	});

	it("rejects invalid JSON syntax", () => {
		const result = parseEventLoopConfig("{ not json");
		expect(result.ok).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("rejects a non-object configuration", () => {
		const result = parseEventLoopConfig("[]");
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("JSON object");
	});

	it("rejects duplicate JSON keys", () => {
		const result = parseEventLoopConfig('{"version":1,"version":2}');
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain('duplicate JSON key "version"');
	});

	it("rejects unknown top-level fields", () => {
		const result = parseEventLoopConfig(configText({ extra: true }));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain('unknown field "extra"');
	});

	it("rejects a version other than 1", () => {
		const result = parseEventLoopConfig(configText({ version: 2 }));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain('"version" must be 1');
	});

	it("rejects an activeProfile that has no matching profile", () => {
		const result = parseEventLoopConfig(
			configText({ activeProfile: "missing" }),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain(
			'"activeProfile" "missing" is not defined',
		);
	});

	it("rejects unknown event, command and view fields", () => {
		const raw = JSON.parse(configText()) as Record<string, unknown>;
		const profile = fixtureObject(fixtureObject(raw, "profiles"), "default");
		fixtureObject(fixtureObject(profile, "events"), "work.completed")["oops"] =
			1;
		fixtureObject(fixtureObject(profile, "commands"), "perform-work")["oops"] =
			1;
		fixtureObject(fixtureObject(profile, "views"), "work-due")["oops"] = 1;
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		const joined = result.errors.join(" ");
		expect(joined).toContain('unknown field "oops"');
		expect(
			result.errors.filter((error) => error.includes('unknown field "oops"'))
				.length,
		).toBe(3);
	});

	it("rejects commands with no expected events and commands referencing undefined events", () => {
		const raw = JSON.parse(configText()) as {
			profiles: Record<string, Record<string, unknown>>;
		};
		const profile = raw["profiles"]["default"] as Record<string, unknown>;
		const commands = profile["commands"] as Record<
			string,
			Record<string, unknown>
		>;
		commands["broken"] = { message: "m", expectedEvents: [] };
		commands["dangling"] = { message: "m", expectedEvents: ["nope.event"] };
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		const joined = result.errors.join(" ");
		expect(joined).toContain('"expectedEvents" must be a non-empty array');
		expect(joined).toContain('expected event "nope.event" is not defined');
	});

	it("rejects views whose closeOn key path does not match any openOn key path", () => {
		const raw = JSON.parse(configText()) as Record<string, unknown>;
		const profile = fixtureObject(fixtureObject(raw, "profiles"), "default");
		fixtureObject(fixtureObject(profile, "views"), "work-due")["closeOn"] = [
			{ event: "work.completed", keyFrom: "/resultPath" },
		];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain(
			'closeOn keyFrom "/resultPath" does not match any openOn key path',
		);
	});

	it("rejects invalid JSON Pointers in keyFrom", () => {
		const raw = JSON.parse(configText()) as Record<string, unknown>;
		const profile = fixtureObject(fixtureObject(raw, "profiles"), "default");
		fixtureObject(fixtureObject(profile, "views"), "work-due")["openOn"] = [
			{ event: "work.requested", keyFrom: "workId" },
		];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain(
			'"keyFrom" must be a valid JSON Pointer',
		);
	});

	it("rejects automations referencing undefined views or commands", () => {
		const raw = JSON.parse(configText()) as {
			profiles: Record<string, Record<string, unknown>>;
		};
		const profile = raw["profiles"]["default"] as Record<string, unknown>;
		profile["automations"] = [
			{ id: "a", view: "no-view", issue: "perform-work" },
			{ id: "b", view: "work-due", issue: "no-command" },
		];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		const joined = result.errors.join(" ");
		expect(joined).toContain('view "no-view" is not defined');
		expect(joined).toContain('command "no-command" is not defined');
	});

	it("rejects duplicate automation ids", () => {
		const raw = JSON.parse(configText()) as {
			profiles: Record<string, Record<string, unknown>>;
		};
		const profile = raw["profiles"]["default"] as Record<string, unknown>;
		profile["automations"] = [
			{ id: "same", view: "work-due", issue: "perform-work" },
			{ id: "same", view: "work-due", issue: "perform-work" },
		];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain('duplicate automation id "same"');
	});

	it("rejects emissionPolicy other than command-contract", () => {
		const raw = JSON.parse(configText()) as {
			profiles: Record<string, Record<string, unknown>>;
		};
		const profile = raw["profiles"]["default"] as Record<string, unknown>;
		profile["emissionPolicy"] = "free-form";
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain(
			'"emissionPolicy" must be "command-contract"',
		);
	});

	it("rejects configuration loading when project is untrusted", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-event-loop-untrusted-"));
		try {
			await writeFileAtomic(join(cwd, ".pi/event-loop.json"), configText());
			const result = await loadEventLoopConfig(cwd, { trusted: false });
			expect(result.ok).toBe(false);
			expect(result.missing).toBe(false);
			expect(result.errors.join(" ")).toContain("project is untrusted");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("loads configuration from custom config directory when specified", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-event-loop-custom-dir-"));
		try {
			await writeFileAtomic(
				join(cwd, "custom-dir/event-loop.json"),
				configText(),
			);
			const result = await loadEventLoopConfig(cwd, {
				configDir: "custom-dir",
			});
			expect(result.ok).toBe(true);
			expect(result.config?.activeProfile).toBe("default");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

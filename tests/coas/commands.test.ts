import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCoasCommands } from "../../extensions/pi-coas/commands.js";
import type { CoasInternalScheduler } from "../../extensions/pi-coas/scheduler.js";

interface CommandDefinition {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface CommandFixture {
	commands: Map<string, CommandDefinition>;
	notify: ReturnType<typeof vi.fn>;
	custom: ReturnType<typeof vi.fn>;
	ctx: ExtensionCommandContext;
	scheduler: CoasInternalScheduler;
}

function makeCommandFixture(cwd: string): CommandFixture {
	const commands = new Map<string, CommandDefinition>();
	const notify = vi.fn();
	const custom = vi.fn(async <T>(): Promise<T | undefined> => undefined);
	const api = {
		registerCommand(name: string, definition: CommandDefinition) {
			commands.set(name, definition);
		},
	} as unknown as ExtensionAPI;
	const scheduler = {
		snapshot: vi.fn(() => ({ running: false, enabledSchedules: 0, activeRuns: 0, spawnedRuns: 0 })),
		reconcile: vi.fn(async () => undefined),
	} as unknown as CoasInternalScheduler;
	registerCoasCommands(api, scheduler);
	const ctx = { cwd, ui: { notify, custom } } as unknown as ExtensionCommandContext;
	return { commands, notify, custom, ctx, scheduler };
}

async function makeCoasHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "pi-coas-command-"));
	await mkdir(join(home, "workspace", "briefing", ".pi", "coas"), { recursive: true });
	await writeFile(join(home, "workspace", "briefing", ".pi", "coas", "workspace.env"), "WORKSPACE_ID=briefing\nPURPOSE=Daily briefing\n");
	await writeFile(join(home, "workspace", "briefing", "CONTEXT.md"), "# Briefing\n");
	return home;
}

describe("CoAS slash commands", () => {
	let home: string | undefined;

	afterEach(async () => {
		if (home) await rm(home, { recursive: true, force: true });
		home = undefined;
		vi.unstubAllEnvs();
	});

	it("registers the complete command surface", async () => {
		home = await makeCoasHome();
		const fixture = makeCommandFixture(home);
		expect([...fixture.commands.keys()]).toEqual([
			"coas-status", "coas-doctor", "coas-workspaces", "coas-schedules", "coas-scheduler",
		]);
	});

	it("parses --text for workspaces and renders the result headlessly", async () => {
		home = await makeCoasHome();
		vi.stubEnv("COAS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("coas-workspaces")?.handler("  --text  ", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("CoAS workspaces", "info");
		expect(fixture.custom).toHaveBeenCalled();
	});

	it("treats unknown workspace arguments as interactive mode rather than text mode", async () => {
		home = await makeCoasHome();
		vi.stubEnv("COAS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("coas-workspaces")?.handler("--json", fixture.ctx);
		expect(fixture.custom).toHaveBeenCalled();
		expect(fixture.notify).not.toHaveBeenCalled();
	});

	it("renders status, doctor, and scheduler responses", async () => {
		home = await makeCoasHome();
		vi.stubEnv("COAS_HOME", home);
		const fixture = makeCommandFixture(home);
		await fixture.commands.get("coas-status")?.handler("", fixture.ctx);
		await fixture.commands.get("coas-doctor")?.handler("", fixture.ctx);
		await fixture.commands.get("coas-scheduler")?.handler("", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("CoAS status", "info");
		expect(fixture.notify).toHaveBeenCalledWith(expect.stringContaining("CoAS doctor exit="), expect.any(String));
		expect(fixture.notify).toHaveBeenCalledWith("CoAS scheduler", "info");
		expect(fixture.scheduler.reconcile).toHaveBeenCalled();
	});
});

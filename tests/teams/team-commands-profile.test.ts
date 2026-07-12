import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runTeamMock = vi.fn(async () => ({ content: [{ type: "text" as const, text: "team output" }] }));

vi.mock("../../extensions/pi-panopticon/teams/team-runtime.js", () => ({
	runTeam: runTeamMock,
}));

const { parseTeamRunArgs, registerTeamCommands } = await import("../../extensions/pi-panopticon/teams/team-commands.js");

interface CommandDefinition {
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function setupCommand(): {
	command: CommandDefinition;
	ctx: ExtensionCommandContext;
	notify: ReturnType<typeof vi.fn>;
	sendUserMessage: ReturnType<typeof vi.fn>;
} {
	let command: CommandDefinition | undefined;
	const sendUserMessage = vi.fn();
	const pi = {
		registerCommand(name: string, definition: CommandDefinition) {
			if (name === "teams") command = definition;
		},
		sendUserMessage,
	} as unknown as ExtensionAPI;
	registerTeamCommands(pi, { stateManager: {} as never });
	if (!command) throw new Error("teams command was not registered");
	const notify = vi.fn();
	const ctx = {
		cwd: "/tmp",
		ui: {
			editor: vi.fn(async () => "editor prompt"),
			notify,
		},
		waitForIdle: vi.fn(async () => undefined),
	} as unknown as ExtensionCommandContext;
	return { command, ctx, notify, sendUserMessage };
}

describe("team command profile parsing", () => {
	beforeEach(() => runTeamMock.mockClear());

	it("parses separated and equals profile options in any position", () => {
		expect(parseTeamRunArgs("navigator review this --profile fast")).toEqual({
			id: "navigator",
			prompt: "review this",
			profile: "fast",
		});
		expect(parseTeamRunArgs("--profile=thorough llm-council inspect API")).toEqual({
			id: "llm-council",
			prompt: "inspect API",
			profile: "thorough",
		});
	});

	it("defaults to balanced and preserves profile-like prompt text after --", () => {
		expect(parseTeamRunArgs("navigator -- explain --profile fast")).toEqual({
			id: "navigator",
			prompt: "explain --profile fast",
			profile: "balanced",
		});
		expect(parseTeamRunArgs("--profile fast")).toEqual({ prompt: "", profile: "fast" });
	});

	it("rejects invalid, missing, and duplicate profiles", () => {
		expect(() => parseTeamRunArgs("navigator --profile instant prompt")).toThrow(/fast, balanced, or thorough/);
		expect(() => parseTeamRunArgs("navigator --profile")).toThrow(/fast, balanced, or thorough/);
		expect(() => parseTeamRunArgs("navigator --profile fast --profile=thorough prompt")).toThrow(/only once/);
	});

	it("passes the selected profile to synchronous team runs and status", async () => {
		const { command, ctx, notify, sendUserMessage } = setupCommand();
		await command.handler("run navigator review this --profile fast", ctx);

		expect(runTeamMock).toHaveBeenCalledWith(expect.objectContaining({
			params: { id: "navigator", prompt: "review this", profile: "fast" },
		}));
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("profile=fast"), "info");
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("profile=fast"), { deliverAs: "followUp" });
	});

	it("accepts profiles for asynchronous team runs", async () => {
		const { command, ctx, notify } = setupCommand();
		await command.handler("async llm-council --profile=thorough review architecture", ctx);

		expect(runTeamMock).toHaveBeenCalledWith(expect.objectContaining({
			params: { id: "llm-council", prompt: "review architecture", profile: "thorough" },
		}));
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("profile=thorough asynchronously"), "info");
	});
});

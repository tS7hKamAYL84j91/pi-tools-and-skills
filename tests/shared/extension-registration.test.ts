/**
 * Extension activation smoke tests.
 *
 * Verifies each extension registers its public tools and slash commands when
 * loaded against a fake ExtensionAPI. This catches refactors that accidentally
 * drop registration calls while still leaving isolated unit tests green.
 */

import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTeams as teamExtension } from "../../extensions/pi-panopticon/teams/register.js";
import kanbanExtension from "../../extensions/pi-kanban/index.js";
import matrixExtension from "../../extensions/pi-matrix/index.js";
import coasExtension from "../../extensions/pi-coas/index.js";
import panopticonExtension from "../../extensions/pi-panopticon/index.js";
import goalExtension from "../../extensions/pi-goal/index.js";
import fileWatchExtension from "../../extensions/pi-file-watch/index.js";
import ollamaModelsExtension from "../../extensions/pi-ollama-models/index.js";

interface NamedRegistration {
	name: string;
}

interface CapturedRegistrations {
	tools: Set<string>;
	commands: Set<string>;
	shortcuts: Set<string>;
	flags: Set<string>;
	events: Set<string>;
}

interface FakeExtensionApi {
	registerTool: (definition: NamedRegistration) => void;
	registerCommand: (name: string, definition: unknown) => void;
	registerShortcut: (key: string, definition: unknown) => void;
	registerFlag: (name: string, definition: unknown) => void;
	on: (event: string, handler: unknown) => void;
	getFlag: (name: string) => unknown;
	sendMessage: (message: unknown, options?: unknown) => void;
	sendUserMessage: (message: string, options?: unknown) => void;
}

function createFakeApi(): {
	api: ExtensionAPI;
	registrations: CapturedRegistrations;
} {
	const registrations: CapturedRegistrations = {
		tools: new Set<string>(),
		commands: new Set<string>(),
		shortcuts: new Set<string>(),
		flags: new Set<string>(),
		events: new Set<string>(),
	};
	const api: FakeExtensionApi = {
		registerTool(definition) {
			registrations.tools.add(definition.name);
		},
		registerCommand(name) {
			registrations.commands.add(name);
		},
		registerShortcut(key) {
			registrations.shortcuts.add(key);
		},
		registerFlag(name) {
			registrations.flags.add(name);
		},
		on(event) {
			registrations.events.add(event);
		},
		getFlag() {
			return undefined;
		},
		sendMessage() {
			// Registration tests do not execute handlers.
		},
		sendUserMessage() {
			// Registration tests do not execute handlers.
		},
	};

	// The fake implements the ExtensionAPI surface used during registration.
	return { api: api as unknown as ExtensionAPI, registrations };
}

function expectRegistered(actual: Set<string>, expected: string[]): void {
	expect([...actual].sort()).toEqual([...expected].sort());
}

describe("extension registration smoke tests", () => {
	it("team extension registers its tools, commands, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		teamExtension(api);

		expectRegistered(registrations.tools, [
			"team_delete",
			"team_describe",
			"team_form",
			"team_list",
			"runtime_status",
			"runtime_stop",
			"team_models",
			"team_run",
			"team_runs",
			"team_stop",
		]);
		expectRegistered(registrations.commands, ["teams", "team"]);
		expectRegistered(registrations.events, [
			"before_provider_request",
			"input",
			"session_start",
			"session_tree",
		]);
	});

	it("kanban registers its tools, commands, flags, shortcuts, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		kanbanExtension(api);

		expectRegistered(registrations.tools, [
			"kanban_block",
			"kanban_claim",
			"kanban_compact",
			"kanban_complete",
			"kanban_create",
			"kanban_delete",
			"kanban_edit",
			"kanban_export_json",
			"kanban_move",
			"kanban_snapshot",
			"kanban_unblock",
		]);
		expectRegistered(registrations.commands, [
			"kanban",
		]);
		expectRegistered(registrations.flags, []);
		expectRegistered(registrations.shortcuts, ["ctrl+shift+k"]);
		expectRegistered(registrations.events, [
			"agent_end",
			"session_shutdown",
			"session_start",
		]);
	});

	it("pi-file-watch registers its tools, command, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		fileWatchExtension(api);

		expectRegistered(registrations.tools, [
			"file_watch_list",
			"file_watch_reload",
		]);
		expectRegistered(registrations.commands, ["file-watch"]);
		expectRegistered(registrations.events, [
			"session_shutdown",
			"session_start",
		]);
	});

	it("matrix registers its command and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		matrixExtension(api);

		expectRegistered(registrations.tools, []);
		expectRegistered(registrations.commands, ["matrix"]);
		expectRegistered(registrations.events, [
			"before_agent_start",
			"session_shutdown",
			"session_start",
		]);
	});

	it("pi-coas registers its tools, commands, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		coasExtension(api);

		expectRegistered(registrations.tools, [
			"coas_doctor",
			"coas_schedule_add",
			"coas_schedule_list",
			"coas_schedule_preview",
			"coas_schedule_remove",
			"coas_schedule_run",
			"coas_status",
			"coas_workspace_create",
			"coas_workspace_list",
			"coas_workspace_read",
			"coas_workspace_update",
		]);
		expectRegistered(registrations.commands, [
			"coas-doctor",
			"coas-scheduler",
			"coas-schedules",
			"coas-status",
			"coas-workspaces",
		]);
		expectRegistered(registrations.events, [
			"before_agent_start",
			"session_shutdown",
			"session_start",
		]);
	});

	it("pi-goal registers its command, tools, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		goalExtension(api);

		expectRegistered(registrations.tools, [
			"goal_complete",
			"goal_get",
		]);
		expectRegistered(registrations.commands, ["goal", "goal-clear"]);
		expectRegistered(registrations.events, [
			"agent_end",
			"before_agent_start",
			"input",
			"session_start",
		]);
	});

	it("pi-panopticon registers its tools, commands, shortcuts, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		panopticonExtension(api);

		expectRegistered(registrations.tools, [
			"agent_broadcast",
			"agent_peek",
			"agent_send",
			"agent_status",
			"get_name",
			"kill_agent",
			"list_spawned",
			"message_read",
			"message_send",
			"rpc_send",
			"runtime_status",
			"runtime_stop",
			"set_name",
			"spawn_agent",
			"team_delete",
			"team_describe",
			"team_form",
			"team_list",
			"team_models",
			"team_run",
			"team_runs",
			"team_stop",
		]);
		expectRegistered(registrations.commands, [
			"agent-list-mode",
			"agents",
			"agents-mode",
			"send",
			"team",
			"teams",
		]);
		expectRegistered(registrations.shortcuts, ["ctrl+shift+o"]);
		expectRegistered(registrations.events, [
			"agent_end",
			"agent_start",
			"before_provider_request",
			"input",
			"model_select",
			"session_shutdown",
			"session_start",
			"session_tree",
		]);
	});

	it("pi-ollama-models registers its tool and session_start hook", () => {
		const { api, registrations } = createFakeApi();

		ollamaModelsExtension(api);

		expectRegistered(registrations.tools, ["pi_ollama_sync_models"]);
		expectRegistered(registrations.commands, []);
		expectRegistered(registrations.events, ["session_start"]);
	});
});

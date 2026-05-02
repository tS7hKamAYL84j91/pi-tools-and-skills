/**
 * Extension activation smoke tests.
 *
 * Verifies each extension registers its public tools and slash commands when
 * loaded against a fake ExtensionAPI. This catches refactors that accidentally
 * drop registration calls while still leaving isolated unit tests green.
 */

import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import councilExtension from "../extensions/pi-llm-council/index.js";
import kanbanExtension from "../extensions/kanban/index.js";
import matrixExtension from "../extensions/matrix/index.js";
import coasExtension from "../extensions/pi-coas/index.js";
import panopticonExtension from "../extensions/pi-panopticon/index.js";

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
	it("council registers its tools, commands, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		councilExtension(api);

		expectRegistered(registrations.tools, [
			"team_describe",
			"team_list",
			"team_run",
		]);
		expectRegistered(registrations.commands, []);
		expectRegistered(registrations.events, [
			"before_provider_request",
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
			"coas_schedule_remove",
			"coas_schedule_run",
			"coas_status",
			"coas_workspace_create",
			"coas_workspace_list",
			"coas_workspace_read",
			"coas_workspace_update",
		]);
		expectRegistered(registrations.commands, [
			"coas-cron-install",
			"coas-cron-uninstall",
			"coas-doctor",
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

	it("pi-panopticon registers its tools, commands, shortcuts, and lifecycle hooks", () => {
		const { api, registrations } = createFakeApi();

		panopticonExtension(api);

		expectRegistered(registrations.tools, [
			"agent_broadcast",
			"agent_peek",
			"agent_send",
			"agent_status",
			"get_alias",
			"kill_agent",
			"list_spawned",
			"message_read",
			"message_send",
			"rpc_send",
			"set_alias",
			"spawn_agent",
		]);
		expectRegistered(registrations.commands, [
			"agent-list-mode",
			"agents",
			"agents-mode",
			"alias",
			"send",
		]);
		expectRegistered(registrations.shortcuts, ["ctrl+shift+o"]);
		expectRegistered(registrations.events, [
			"agent_end",
			"agent_start",
			"input",
			"model_select",
			"session_shutdown",
			"session_start",
		]);
	});
});

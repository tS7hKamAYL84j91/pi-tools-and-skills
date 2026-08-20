/**
 * Extension activation smoke tests.
 *
 * Verifies each extension registers its public tools and slash commands when
 * loaded against a fake ExtensionAPI. This catches refactors that accidentally
 * drop registration calls while still leaving isolated unit tests green.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import coasExtension from "../../extensions/pi-coas/index.js";
import doctorExtension from "../../extensions/pi-doctor/index.js";
import fileWatchExtension from "../../extensions/pi-file-watch/index.js";
import goalExtension from "../../extensions/pi-goal/index.js";
import kanbanExtension from "../../extensions/pi-kanban/index.js";
import matrixExtension from "../../extensions/pi-matrix/index.js";
import ollamaModelsExtension from "../../extensions/pi-ollama-models/index.js";
import panopticonExtension from "../../extensions/pi-panopticon/index.js";
import { registerTeams as teamExtension } from "../../extensions/pi-panopticon/teams/register.js";

interface ToolParameters {
	properties?: Record<string, unknown>;
}

interface NamedRegistration {
	name: string;
	parameters?: ToolParameters;
}

interface CapturedRegistrations {
	tools: Set<string>;
	toolParameters: Map<string, ToolParameters>;
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
		toolParameters: new Map<string, ToolParameters>(),
		commands: new Set<string>(),
		shortcuts: new Set<string>(),
		flags: new Set<string>(),
		events: new Set<string>(),
	};
	const api: FakeExtensionApi = {
		registerTool(definition) {
			registrations.tools.add(definition.name);
			if (definition.parameters) {
				registrations.toolParameters.set(
					definition.name,
					definition.parameters,
				);
			}
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

function expectDeprecatedGateParameter(
	registrations: CapturedRegistrations,
	toolName: string,
	parameterName: "gateCommand" | "gate_command",
): void {
	const parameters = registrations.toolParameters.get(toolName);
	expect(parameters, `${toolName} parameters`).toBeDefined();
	const property = parameters?.properties?.[parameterName];
	expect(property, `${toolName}.${parameterName}`).toMatchObject({
		deprecated: true,
		description: expect.stringMatching(/ignored.*never executed/i),
	});
}

describe("extension registration smoke tests", () => {
	it("retains deprecated, ignored gate inputs in Doctor, Goal, and Kanban public schemas", () => {
		const doctor = createFakeApi();
		doctorExtension(doctor.api);
		expectDeprecatedGateParameter(
			doctor.registrations,
			"pi_doctor",
			"gateCommand",
		);

		const goal = createFakeApi();
		goalExtension(goal.api);
		expectDeprecatedGateParameter(
			goal.registrations,
			"goal_complete",
			"gate_command",
		);

		const kanban = createFakeApi();
		kanbanExtension(kanban.api);
		expectDeprecatedGateParameter(
			kanban.registrations,
			"kanban_complete",
			"gate_command",
		);
	});
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
		expectRegistered(registrations.commands, ["kanban"]);
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
			"coas_approval_approve",
			"coas_approval_defer",
			"coas_approval_inbox_list",
			"coas_approval_reject",
			"coas_doctor",
			"coas_governance_resolve",
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
			"agent_end",
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
			"goal_plan",
			"goal_verify",
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
			"swarm_list",
			"swarm_run",
			"swarm_status",
			"swarm_stop",
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
			"agent-external-list",
			"agent-external-register",
			"agent-external-remove",
			"agent-list-mode",
			"agents",
			"agents-mode",
			"boost",
			"send",
			"swarm",
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

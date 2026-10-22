/**
 * Session naming tool registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ok, fail, type ToolResult } from "../types.js";
import type { Registry } from "../types.js";
import { isValidAgentName } from "../../../lib/agent-registry.js";

function validateName(name: string | undefined): string | undefined {
	const trimmed = name?.trim();
	if (!trimmed) {
		return undefined;
	}
	if (!isValidAgentName(trimmed)) {
		throw new Error(
			"Name must start with alphanumeric, then alphanumeric/hyphens/dots/underscores (no '/' or '#')",
		);
	}
	return trimmed;
}

function getNameDetails(pi: ExtensionAPI, registry: Registry): {
	sessionName: string | undefined;
	registryName: string | undefined;
	spawnName: string | undefined;
	nameSource: string | undefined;
} {
	const record = registry.getRecord();
	return {
		sessionName: pi.getSessionName(),
		registryName: record?.name,
		spawnName: record?.spawn_name,
		nameSource: record?.name_source,
	};
}

function formatName(details: ReturnType<typeof getNameDetails>): string {
	return [
		`Session name: ${details.sessionName ?? "(none)"}`,
		`Registry name: ${details.registryName ?? "(none)"}`,
		`Spawn name: ${details.spawnName ?? "(none)"}`,
	].join("\n");
}

function setName(pi: ExtensionAPI, registry: Registry, name: string): boolean {
	// Registry first: its claim guard is authoritative; only commit the session
	// name when the registry accepted the rename.
	if (!registry.setName(name, "programmatic")) return false;
	pi.setSessionName(name);
	return true;
}

export function registerNameControls(pi: ExtensionAPI, registry: Registry): void {
	pi.registerTool({
		name: "get_name",
		label: "Get Name",
		description: "Get the current agent/session name, registry name, and spawn name metadata.",
		promptSnippet: "Get the current agent/session name",
		parameters: Type.Object({}),
		async execute(): Promise<ToolResult> {
			const details = getNameDetails(pi, registry);
			return ok(formatName(details), details);
		},
	});

	pi.registerTool({
		name: "set_name",
		label: "Set Name",
		description: "Set the session display name and update the Agent Hub registry name.",
		promptSnippet: "Set the current session/agent name",
		parameters: Type.Object({
			name: Type.String({ description: "Name to use for this session/agent" }),
		}),
		async execute(_id, params): Promise<ToolResult> {
			try {
				const name = validateName(params.name);
				if (!name) {
					return fail("Name cannot be empty.", { reason: "empty_name" });
				}
				// A prefix is not authority: refuse to shadow another live agent's
					// name (impersonation/DoS) before the session name is committed.
				if (!registry.canClaimName(name)) {
					return fail(
						`Name "${name}" is already used by another live agent. Pick a different name.`,
						{ reason: "name_taken", name },
					);
				}
				if (!setName(pi, registry, name)) {
					return fail(
						`Name "${name}" is already used by another live agent. Pick a different name.`,
						{ reason: "name_taken", name },
					);
				}
				return ok(`Name set to ${name}.`, { name });
			} catch (err) {
				return fail((err as Error).message, { reason: "invalid_name" });
			}
		},
	});
}

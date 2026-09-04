/** Description and parameter formatting helpers for event_loop_emit (SPEC §7). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_RELATIVE_PATH,
	parseEventLoopConfig,
} from "./config.js";
import type { EventLoopRuntime } from "./runtime.js";
import type { EventLoopConfig } from "./types.js";

export const DEFAULT_DESCRIPTION =
	"Emit a domain event to the pi-event-loop session event log. The active profile defines which " +
	"events may be emitted and which payload fields they require; event_loop_context reports the live " +
	"contract, and the active command message lists its expected outcome events. With the command-contract " +
	"emission policy, an emitted event must be one of the active command's expected events, or an event " +
	"declared allowWithoutCommand when no command is active.";

function formatEventDoc(
	name: string,
	spec: {
		readonly description: string;
		readonly requiredPayload: readonly string[];
		readonly allowWithoutCommand?: boolean;
	},
	withContext = false,
): string {
	const fields =
		spec.requiredPayload.length > 0
			? spec.requiredPayload.join(", ")
			: "none";
	const note =
		withContext && spec.allowWithoutCommand === true
			? " (also allowed without an active command)"
			: "";
	return `- ${name}: ${spec.description} Required payload: ${fields}.${note}`;
}

export function buildDescriptionFromConfig(
	config: EventLoopConfig,
	runtime?: EventLoopRuntime,
): string {
	const profile = config.profiles[config.activeProfile];
	if (profile === undefined) {
		return DEFAULT_DESCRIPTION;
	}
	const lines = [
		"Emit a domain event to the pi-event-loop session event log.",
		"",
	];
	const activeCommand = runtime?.activeCommand;
	if (activeCommand !== undefined) {
		lines.push(
			`Active command: "${activeCommand.type}" (${activeCommand.commandId}).`,
			"Events expected by the active command:",
		);
		for (const eventName of activeCommand.expectedEvents) {
			const spec = profile.events[eventName];
			if (spec?.allowAgentEmit) {
				lines.push(formatEventDoc(eventName, spec));
			}
		}
	} else {
		lines.push("Events you may emit:");
		for (const [eventName, spec] of Object.entries(profile.events)) {
			if (spec.allowAgentEmit) {
				lines.push(formatEventDoc(eventName, spec, true));
			}
		}
	}
	lines.push(
		"",
		"During an active command turn you may only emit that command's expected events; the command message lists them.",
		"Always pass a stable dedupeKey (include the work item id) so retries are idempotent.",
	);
	return lines.join("\n");
}

/** Description generated from the profile active at registration time (SPEC §7). */
export function buildDescriptionFromProfile(
	cwd: string,
	runtime?: EventLoopRuntime,
): string {
	let text: string;
	try {
		text = readFileSync(join(cwd, CONFIG_RELATIVE_PATH), "utf8");
	} catch {
		return DEFAULT_DESCRIPTION;
	}
	const parsed = parseEventLoopConfig(text);
	if (!parsed.ok || parsed.config === undefined) {
		return DEFAULT_DESCRIPTION;
	}
	return buildDescriptionFromConfig(parsed.config, runtime);
}

/**
 * Team model runner — invokes a single pi model in non-interactive mode.
 *
 * Persistent RPC agents (lib/spawn-service) are overkill for one-shot
 * team run queries; spinning up the RPC channel costs more than the
 * `pi --print` invocation it replaces.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCurrentAgent } from "../../../lib/agent-api.js";
import {
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_VISIBILITY_ENV,
} from "../../../lib/agent-registry.js";
import { resolvePiBinary } from "../../../lib/spawn-service.js";
import { spawnRuntimeChildProcess } from "../../../lib/runtime-child-process.js";
import providerOverridesExtension, { PROVIDER_PARAMETERS_ENV } from "./provider-overrides-extension.js";
import type { TeamParticipant, GenerationParameterValue, ModelRun } from "./types.js";

interface PanopticonRecord {
	id: string;
	name: string;
}

/** Locate this orchestrator's panopticon id and name through the agent API. */
export async function currentPanopticonRecord(
	cwd: string,
): Promise<PanopticonRecord | undefined> {
	const match = findCurrentAgent(cwd);
	if (!match) {
		return undefined;
	}
	return { id: match.id, name: match.registryName };
}

interface RunModelArgs {
	prompt: string;
	systemPrompt: string;
	cwd: string;
	signal?: AbortSignal;
	parentId?: string;
	tools?: string[];
	parameters?: Record<string, GenerationParameterValue>;
}

interface PiModelResult {
	prompt: string;
	systemPrompt: string;
	output: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	// Narrowed by the object/null guard; keys are inspected defensively below.
	return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function assistantTextFromMessage(value: unknown): string | undefined {
	const message = asRecord(value);
	if (message?.role !== "assistant") return undefined;
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content
		.map((entry) => {
			const item = asRecord(entry);
			return item?.type === "text" && typeof item.text === "string" ? item.text : undefined;
		})
		.filter((part): part is string => part !== undefined);
	return parts.length > 0 ? parts.join("\n") : undefined;
}

function finalAssistantTextFromEvent(value: unknown): string | undefined {
	const event = asRecord(value);
	if (!event) return undefined;
	if (event.type === "agent_end" && Array.isArray(event.messages)) {
		for (const message of [...event.messages].reverse()) {
			const text = assistantTextFromMessage(message);
			if (text !== undefined) return text;
		}
	}
	if ((event.type === "message_end" || event.type === "turn_end") && "message" in event) {
		return assistantTextFromMessage(event.message);
	}
	return assistantTextFromMessage(event);
}

export function extractPiPrintOutput(stdout: string): string {
	let finalAssistantText: string | undefined;
	let sawJsonEvent = false;
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
		try {
			const text = finalAssistantTextFromEvent(JSON.parse(trimmed));
			if (text !== undefined) {
				finalAssistantText = text;
				sawJsonEvent = true;
			}
		} catch {
			// Non-JSON stdout is the normal text-mode path.
		}
	}
	return (sawJsonEvent ? finalAssistantText ?? "" : stdout).trim();
}

/**
 * Honors the AbortSignal: aborted runs send SIGTERM and resolve with
 * { ok: false, error: "cancelled" } rather than rejecting.
 */
const PROVIDER_OVERRIDES_EXTENSION = join(
	dirname(fileURLToPath(import.meta.url)),
	"provider-overrides-extension.ts",
);
void providerOverridesExtension;

export function toolArgs(tools: string[] | undefined): string[] {
	if (tools === undefined) {
		return [];
	}
	return tools.length > 0 ? ["--tools", tools.join(",")] : ["--no-tools"];
}

/** Spawn-result shape used by {@link mapSpawnResultToModelRun}. */
interface SpawnResultLike {
	stdout: string;
	stderr: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

/**
 * Maps a `pi --print` child result to a {@link PiModelResult}.
 *
 * Team member/synthesis nodes are one-shot `--print --no-session` calls that
 * must produce output. A child that exits successfully with empty stdout is a
 * silent failure (e.g. a CoAS lockfile wrapper aborting a non-interactive
 * duplicate launch with a stderr warning and exit 0). Surface it as a loud
 * error instead of returning an empty "done" result.
 */
export function mapSpawnResultToModelRun(
	args: { prompt: string; systemPrompt: string },
	result: SpawnResultLike,
): PiModelResult {
	const output = extractPiPrintOutput(result.stdout);
	const stderr = result.stderr.trim();
	if (result.ok && !output.trim()) {
		return {
			prompt: args.prompt,
			systemPrompt: args.systemPrompt,
			output: "",
			durationMs: result.durationMs,
			ok: false,
			error: stderr
				? `pi --print child exited successfully but produced no output. stderr: ${stderr}`
				: "pi --print child exited successfully but produced no output.",
		};
	}
	return {
		prompt: args.prompt,
		systemPrompt: args.systemPrompt,
		output,
		durationMs: result.durationMs,
		ok: result.ok,
		...(result.ok ? {} : { error: stderr || result.error }),
	};
}

function runPiModel(model: string, args: RunModelArgs): Promise<PiModelResult> {
	const parameters = args.parameters;
	const hasParameters = parameters !== undefined && Object.keys(parameters).length > 0;
	const piArgs = [
		"--print",
		"--model",
		model,
		...toolArgs(args.tools),
		...(hasParameters ? ["--extension", PROVIDER_OVERRIDES_EXTENSION] : []),
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-session",
		"--system-prompt",
		args.systemPrompt,
		args.prompt,
	];

	return spawnRuntimeChildProcess({
		label: "pi model run",
		command: resolvePiBinary(),
		args: piArgs,
		cwd: args.cwd,
		signal: args.signal,
		env: {
			// Team member/synthesis nodes are stateless `--print --no-session`
			// one-shots. They do not register a panopticon agent or take a
			// workspace lock, so the CoAS lockfile wrapper's duplicate-launch
			// guard must not abort them.
			COAS_PI_LOCKFILE_CONTINUE: "1",
			...(hasParameters
				? { [PROVIDER_PARAMETERS_ENV]: JSON.stringify(parameters) }
				: {}),
			...(args.parentId
				? {
						[PANOPTICON_PARENT_ID_ENV]: args.parentId,
						[PANOPTICON_VISIBILITY_ENV]: "scoped",
					}
				: {}),
		},
	}).then((result) =>
		mapSpawnResultToModelRun({ prompt: args.prompt, systemPrompt: args.systemPrompt }, result),
	);
}

/** Run a single member and package the result into a ModelRun. */
export async function runMember(
	member: TeamParticipant,
	args: RunModelArgs,
): Promise<ModelRun> {
	const result = await runPiModel(member.model, {
		...args,
		tools: args.tools !== undefined ? args.tools : member.tools,
		parameters: args.parameters !== undefined ? args.parameters : member.parameters,
	});
	return { member, ...result };
}

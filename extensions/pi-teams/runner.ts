/**
 * Team model runner — invokes a single pi model in non-interactive mode.
 *
 * Persistent RPC agents (lib/spawn-service) are overkill for one-shot
 * team run queries; spinning up the RPC channel costs more than the
 * `pi --print` invocation it replaces.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCurrentAgent } from "../../lib/agent-api.js";
import {
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_VISIBILITY_ENV,
} from "../../lib/agent-registry.js";
import { resolvePiBinary } from "../../lib/spawn-service.js";
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

function runPiModel(model: string, args: RunModelArgs): Promise<PiModelResult> {
	const startedAt = Date.now();
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

	return new Promise((resolve) => {
		const child = spawn(resolvePiBinary(), piArgs, {
			cwd: args.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
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
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (ok: boolean, error?: string) => {
			if (settled) return;
			settled = true;
			args.signal?.removeEventListener("abort", abort);
			resolve({
				prompt: args.prompt,
				systemPrompt: args.systemPrompt,
				output: stdout.trim(),
				durationMs: Date.now() - startedAt,
				ok,
				...(error ? { error } : {}),
			});
		};
		const abort = () => {
			try {
				child.kill("SIGTERM");
			} catch {
				/* best-effort */
			}
			finish(false, "cancelled");
		};

		args.signal?.addEventListener("abort", abort, { once: true });
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => finish(false, error.message));
		child.on("close", (code) => {
			if (code === 0) finish(true);
			else finish(false, stderr.trim() || `pi exited with code ${code}`);
		});
	});
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

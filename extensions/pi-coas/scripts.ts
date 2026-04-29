/**
 * CoAS extension command execution wrappers.
 */

import { access } from "node:fs/promises";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { coasScript } from "./config.js";
import type { CoasConfig, CommandResult } from "./types.js";

interface RunScriptOptions {
	args?: string[];
	signal?: AbortSignal;
}

async function assertExecutable(path: string): Promise<void> {
	try {
		await access(path);
	} catch {
		throw new Error(`CoAS script not found: ${path}`);
	}
}

export async function runCoasScript(
	pi: ExtensionAPI,
	config: CoasConfig,
	scriptName: string,
	options: RunScriptOptions = {},
): Promise<CommandResult> {
	const script = coasScript(config, scriptName);
	await assertExecutable(script);
	const result = await pi.exec("env", [`COAS_HOME=${config.coasHome}`, script, ...(options.args ?? [])], {
		signal: options.signal,
		timeout: 120_000,
	});
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		code: result.code ?? 0,
	};
}

export async function runStatus(pi: ExtensionAPI, config: CoasConfig, signal?: AbortSignal): Promise<CommandResult> {
	return runCoasScript(pi, config, "coas-status", { signal });
}

export async function runDoctor(pi: ExtensionAPI, config: CoasConfig, signal?: AbortSignal): Promise<CommandResult> {
	return runCoasScript(pi, config, "coas-doctor", { signal });
}

export async function runSchedule(
	pi: ExtensionAPI,
	config: CoasConfig,
	args: string[],
	signal?: AbortSignal,
): Promise<CommandResult> {
	return runCoasScript(pi, config, "coas-schedule", { args, signal });
}

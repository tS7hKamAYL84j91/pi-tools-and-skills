#!/usr/bin/env node
/** Thin explicit CLI wrapper for the local session spooling runner POC. */

import { runSessionSpoolOnce } from "./session-spool-runner.js";

interface CliArgs {
	registryDir?: string;
	sourceFile?: string;
	sourceRoot?: string;
	agentId?: string;
	name?: string;
	cwd?: string;
	maxEvents?: number;
}

function usage(): string {
	return [
		"Usage: npx tsx lib/session-spool-runner-cli.ts --registry-dir <absolute-dir> --source-file <relative-or-absolute-jsonl> --agent-id <id> --name <display-name> --cwd <cwd> [--source-root <dir>] [--max-events N]",
		"",
		"Explicit local POC only. Requires an installed session-spool-hook manifest; no default/background hook is enabled.",
	].join("\n");
}

function parseArgs(argv: readonly string[]): CliArgs {
	const args: CliArgs = {};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--")) throw new Error(usage());
		if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}\n${usage()}`);
		index++;
		if (flag === "--registry-dir") args.registryDir = value;
		else if (flag === "--source-file") args.sourceFile = value;
		else if (flag === "--source-root") args.sourceRoot = value;
		else if (flag === "--agent-id") args.agentId = value;
		else if (flag === "--name") args.name = value;
		else if (flag === "--cwd") args.cwd = value;
		else if (flag === "--max-events") args.maxEvents = Number.parseInt(value, 10);
		else throw new Error(`Unknown argument: ${flag}\n${usage()}`);
	}
	return args;
}

export async function runSessionSpoolRunnerCli(argv: readonly string[]): Promise<unknown> {
	const args = parseArgs(argv);
	if (!args.registryDir || !args.sourceFile || !args.agentId || !args.name || !args.cwd) throw new Error(usage());
	return runSessionSpoolOnce({
		registryDir: args.registryDir,
		sourceFile: args.sourceFile,
		...(args.sourceRoot !== undefined ? { sourceRoot: args.sourceRoot } : {}),
		agentId: args.agentId,
		name: args.name,
		cwd: args.cwd,
		...(args.maxEvents !== undefined ? { maxEvents: args.maxEvents } : {}),
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runSessionSpoolRunnerCli(process.argv.slice(2))
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}

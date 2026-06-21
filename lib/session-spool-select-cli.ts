#!/usr/bin/env node
/** Explicit CLI combining read-only session discovery with one-shot spooling. */

import { listRecentSessionSources } from "./session-source-discovery.js";
import { runSessionSpoolOnce } from "./session-spool-runner.js";

interface SelectCliArgs {
	sourceRoot?: string;
	limit?: number;
	pick?: number;
	spool?: boolean;
	registryDir?: string;
	agentId?: string;
	name?: string;
	cwd?: string;
	maxEvents?: number;
}

function usage(): string {
	return [
		"Usage: npx tsx lib/session-spool-select-cli.ts [--source-root <dir>] [--limit N] [--pick N --spool --registry-dir <absolute-dir> --agent-id <id> --name <display-name> --cwd <cwd>] [--max-events N]",
		"",
		"Lists recent pi session sources read-only by default. Spooling runs only when both --pick and --spool are supplied explicitly.",
	].join("\n");
}

function parseArgs(argv: readonly string[]): SelectCliArgs {
	const args: SelectCliArgs = {};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (flag === "--spool") {
			args.spool = true;
			continue;
		}
		const value = argv[index + 1];
		if (!flag?.startsWith("--")) throw new Error(usage());
		if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}\n${usage()}`);
		index++;
		if (flag === "--source-root") args.sourceRoot = value;
		else if (flag === "--limit") args.limit = Number.parseInt(value, 10);
		else if (flag === "--pick") args.pick = Number.parseInt(value, 10);
		else if (flag === "--registry-dir") args.registryDir = value;
		else if (flag === "--agent-id") args.agentId = value;
		else if (flag === "--name") args.name = value;
		else if (flag === "--cwd") args.cwd = value;
		else if (flag === "--max-events") args.maxEvents = Number.parseInt(value, 10);
		else throw new Error(`Unknown argument: ${flag}\n${usage()}`);
	}
	return args;
}

/** Run the explicit discovery/select/spool CLI. */
export async function runSessionSpoolSelectCli(argv: readonly string[]): Promise<unknown> {
	const args = parseArgs(argv);
	const sources = await listRecentSessionSources({ sourceRoot: args.sourceRoot, limit: args.limit });
	if (!args.spool && args.pick === undefined) {
		return {
			mode: "discover",
			sources: sources.map((source, index) => ({ index, ...source })),
			next: "Re-run with --pick N --spool plus registry/name/cwd arguments to spool one listed source.",
		};
	}
	if (!args.spool || args.pick === undefined) throw new Error(`Spooling requires both --pick N and --spool.\n${usage()}`);
	if (!args.registryDir || !args.agentId || !args.name || !args.cwd) throw new Error(usage());
	if (!Number.isInteger(args.pick) || args.pick < 0 || args.pick >= sources.length) throw new Error("pick index is out of range");
	const source = sources[args.pick];
	if (!source) throw new Error("pick index is out of range");
	const result = await runSessionSpoolOnce({
		registryDir: args.registryDir,
		sourceFile: source.relativePath,
		...(args.sourceRoot !== undefined ? { sourceRoot: args.sourceRoot } : {}),
		agentId: args.agentId,
		name: args.name,
		cwd: args.cwd,
		...(args.maxEvents !== undefined ? { maxEvents: args.maxEvents } : {}),
	});
	return { mode: "spool", selected: { index: args.pick, ...source }, result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runSessionSpoolSelectCli(process.argv.slice(2))
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}

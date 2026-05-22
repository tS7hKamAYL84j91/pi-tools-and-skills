#!/usr/bin/env node
/** Thin CLI for read-only pi session source discovery. */

import { listRecentSessionSources } from "./session-source-discovery.js";

interface SourceCliArgs {
	sourceRoot?: string;
	limit?: number;
}

function usage(): string {
	return "Usage: npx tsx lib/session-source-cli.ts [--source-root <dir>] [--limit N]";
}

function parseArgs(argv: readonly string[]): SourceCliArgs {
	const args: SourceCliArgs = {};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}\n${usage()}`);
		index++;
		if (flag === "--source-root") args.sourceRoot = value;
		else if (flag === "--limit") args.limit = Number.parseInt(value, 10);
		else throw new Error(`Unknown argument: ${flag}\n${usage()}`);
	}
	return args;
}

export async function runSessionSourceCli(argv: readonly string[]): Promise<unknown> {
	const args = parseArgs(argv);
	return listRecentSessionSources(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runSessionSourceCli(process.argv.slice(2))
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}

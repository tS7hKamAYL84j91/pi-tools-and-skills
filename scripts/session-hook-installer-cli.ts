#!/usr/bin/env node
/** Thin CLI adapter for the session spool hook installer library. */

import { manageSessionSpoolHook, type SessionHookAction } from "../lib/session-hook-installer.js";

interface HookCliArgs {
	action?: SessionHookAction;
	registryDir?: string;
	retentionEvents?: number;
}

const ACTIONS = new Set<SessionHookAction>(["status", "install", "uninstall", "dry-run"]);

function usage(): string {
	return [
		"Usage: npx tsx scripts/session-hook-installer-cli.ts <status|install|uninstall|dry-run> --registry-dir <absolute-local-dir> [--retention-events N]",
		"",
		"Off-by-default local POC. No global hooks are installed; this delegates to the session hook installer library.",
	].join("\n");
}

function parseArgs(argv: readonly string[]): HookCliArgs {
	const [action, ...rest] = argv;
	if (!ACTIONS.has(action as SessionHookAction)) throw new Error(usage());
	const args: HookCliArgs = { action: action as SessionHookAction };
	for (let index = 0; index < rest.length; index++) {
		const flag = rest[index];
		const value = rest[index + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}\n${usage()}`);
		index++;
		if (flag === "--registry-dir") args.registryDir = value;
		else if (flag === "--retention-events") args.retentionEvents = Number.parseInt(value, 10);
		else throw new Error(`Unknown argument: ${flag}\n${usage()}`);
	}
	return args;
}

export async function runSessionHookInstallerCli(argv: readonly string[]): Promise<unknown> {
	const args = parseArgs(argv);
	if (!args.action || !args.registryDir) throw new Error(usage());
	return manageSessionSpoolHook(args.action, {
		registryDir: args.registryDir,
		...(args.retentionEvents !== undefined ? { retentionEvents: args.retentionEvents } : {}),
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runSessionHookInstallerCli(process.argv.slice(2))
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}

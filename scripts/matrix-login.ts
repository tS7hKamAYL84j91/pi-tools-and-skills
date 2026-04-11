#!/usr/bin/env -S npx tsx
/**
 * matrix-login.ts — Bot account provisioning for the matrix extension.
 *
 * Performs a Matrix /_matrix/client/v3/login password exchange and prints
 * the resulting access token. Used both for first-time bot setup and for
 * token rotation.
 *
 * Usage:
 *   npx tsx scripts/matrix-login.ts \
 *     --homeserver https://matrix.org \
 *     --user @coas-bot:matrix.org
 *
 *   # The script prompts for the password on stdin.
 *
 * After running, store the token in your platform's secret store:
 *
 *   macOS:
 *     security add-generic-password -a coas -s matrix-token -w "syt_..."
 *
 *   Linux:
 *     echo "syt_..." | pass insert -e coas/matrix-token
 *
 * Then export it via the coas-secrets wrapper before starting pi.
 *
 * No external dependencies — uses only Node built-ins.
 */

import { createInterface } from "node:readline";

interface Args {
	homeserver: string;
	user: string;
	deviceDisplayName: string;
}

function parseArgs(argv: string[]): Args {
	const args: Partial<Args> = { deviceDisplayName: "CoAS Chief of Staff (extension)" };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = argv[i + 1];
		switch (flag) {
			case "--homeserver":
				if (!value) usage("--homeserver requires a URL");
				args.homeserver = value;
				i++;
				break;
			case "--user":
				if (!value) usage("--user requires an MXID");
				args.user = value;
				i++;
				break;
			case "--device-name":
				if (!value) usage("--device-name requires a string");
				args.deviceDisplayName = value;
				i++;
				break;
			case "-h":
			case "--help":
				usage();
				break;
			default:
				if (flag?.startsWith("--")) usage(`unknown flag: ${flag}`);
		}
	}
	if (!args.homeserver) usage("--homeserver is required");
	if (!args.user) usage("--user is required");
	return args as Args;
}

function usage(error?: string): never {
	if (error) console.error(`error: ${error}\n`);
	console.error("usage: npx tsx scripts/matrix-login.ts --homeserver <url> --user <mxid> [--device-name <name>]");
	console.error("");
	console.error("examples:");
	console.error("  npx tsx scripts/matrix-login.ts \\");
	console.error("    --homeserver https://matrix.org \\");
	console.error("    --user @coas-bot:matrix.org");
	console.error("");
	console.error("  npx tsx scripts/matrix-login.ts \\");
	console.error("    --homeserver https://coas-matrix.tail12345.ts.net \\");
	console.error("    --user @coas-bot:coas-matrix.tail12345.ts.net \\");
	console.error("    --device-name 'CoAS Chief of Staff (extension)'");
	process.exit(error ? 1 : 0);
}

/** Read a line from stdin without echoing it. Used for the password prompt. */
async function readPasswordPrompt(prompt: string): Promise<string> {
	process.stderr.write(prompt);

	// Toggle terminal echo off if stdin is a TTY
	const stdin = process.stdin;
	const wasRawMode = stdin.isTTY ? stdin.isRaw : false;
	if (stdin.isTTY) stdin.setRawMode(true);

	return new Promise((resolve) => {
		let buffer = "";
		const onData = (chunk: Buffer): void => {
			const str = chunk.toString("utf8");
			for (const ch of str) {
				if (ch === "\r" || ch === "\n") {
					stdin.removeListener("data", onData);
					if (stdin.isTTY) stdin.setRawMode(wasRawMode);
					stdin.pause();
					process.stderr.write("\n");
					resolve(buffer);
					return;
				}
				if (ch === "\u0003") {
					// ctrl+c
					stdin.removeListener("data", onData);
					if (stdin.isTTY) stdin.setRawMode(wasRawMode);
					process.stderr.write("\n");
					process.exit(130);
				}
				if (ch === "\u007f" || ch === "\b") {
					// backspace
					buffer = buffer.slice(0, -1);
					continue;
				}
				buffer += ch;
			}
		};
		stdin.on("data", onData);
		stdin.resume();
	});
}

/** Fall back to a non-TTY readline prompt if stdin is piped. */
async function readPasswordFallback(prompt: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

async function readPassword(): Promise<string> {
	const prompt = "Bot password: ";
	if (process.stdin.isTTY) return readPasswordPrompt(prompt);
	return readPasswordFallback(prompt);
}

interface LoginResponse {
	user_id: string;
	access_token: string;
	home_server?: string;
	device_id: string;
}

async function login(args: Args, password: string): Promise<LoginResponse> {
	// Extract the localpart from the MXID — Matrix /login takes either form,
	// but the localpart is the more portable choice.
	const localpart = args.user.startsWith("@") ? args.user.slice(1).split(":")[0] : args.user;

	const url = `${args.homeserver.replace(/\/$/, "")}/_matrix/client/v3/login`;
	const body = {
		type: "m.login.password",
		identifier: { type: "m.id.user", user: localpart },
		password,
		initial_device_display_name: args.deviceDisplayName,
	};

	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Matrix login failed: HTTP ${response.status} — ${text}`);
	}

	const data = (await response.json()) as LoginResponse;
	if (!data.access_token) throw new Error(`Matrix login response did not include an access_token: ${JSON.stringify(data)}`);
	return data;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const password = await readPassword();
	if (!password) {
		console.error("error: empty password");
		process.exit(1);
	}

	let result: LoginResponse;
	try {
		result = await login(args, password);
	} catch (err) {
		console.error(`error: ${(err as Error).message}`);
		process.exit(1);
	}

	// Print result to stdout in a script-friendly form. The token goes to a
	// separate stream from the metadata so it's easy to redirect / pipe.
	console.error("");
	console.error("✓ Login successful");
	console.error(`  user_id:    ${result.user_id}`);
	console.error(`  device_id:  ${result.device_id}`);
	console.error(`  home_server: ${result.home_server ?? "(unspecified)"}`);
	console.error("");
	console.error("Access token (paste into your secret store):");
	console.log(result.access_token);
	console.error("");
	console.error("Next steps:");
	console.error("  macOS:  security add-generic-password -a coas -s matrix-token -w '...'");
	console.error("  Linux:  echo '...' | pass insert -e coas/matrix-token");
	console.error("");
	console.error("Then export the token via your coas-secrets wrapper before starting pi.");
}

main().catch((err) => {
	console.error(`fatal: ${(err as Error).message}`);
	process.exit(1);
});

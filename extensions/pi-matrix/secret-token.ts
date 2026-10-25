/**
 * Resolve a dedicated Matrix credential from the CoAS secret store.
 *
 * A rendered profile may name a secret (`matrix.tokenSecret`) instead of pointing
 * at an inherited environment variable. Resolution runs the existing
 * `coas-secrets get <ref>` wrapper, so the **only** value on argv is the secret
 * reference — never the token — and stdout is captured, never logged.
 *
 * Failure is always fatal: a profile that asks for a dedicated credential must not
 * silently fall back to the shared inherited token, because that would put a lead
 * in another lead's identity without anyone noticing.
 */

import { execFileSync } from "node:child_process";

/** Secret key name shape: no spaces, no shell metacharacters, not option-like. */
const SECRET_REFERENCE = /^matrix-token(?:-[A-Za-z0-9][A-Za-z0-9._-]{0,113})?$/;
/** Opaque Matrix access token: printable ASCII, no whitespace, bounded length. */
const ACCESS_TOKEN = /^[\x21-\x7e]{8,1024}$/;

/** Environment variable that overrides which wrapper binary is executed. */
export const SECRETS_BIN_ENV = "COAS_SECRETS_BIN";
/** Existing CoAS override, honoured second so launchers keep working. */
export const SECRETS_WRAPPER_ENV = "COAS_SECRETS_WRAPPER";
const DEFAULT_SECRETS_BIN = "coas-secrets";

export type SecretRunner = (bin: string, args: string[]) => string;

export interface ResolveSecretTokenOptions {
	env?: NodeJS.ProcessEnv;
	/** Injection point for tests; production uses execFileSync. */
	run?: SecretRunner;
}

function defaultRunner(bin: string, args: string[]): string {
	// No shell: the reference cannot become a command. The secret value is only
	// ever on stdout, never in argv, the environment of the child, or our logs.
	return execFileSync(bin, args, {
		encoding: "utf8",
		timeout: 15_000,
		maxBuffer: 64 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function secretsBin(env: NodeJS.ProcessEnv): string {
	return (
		env[SECRETS_BIN_ENV]?.trim() ||
		env[SECRETS_WRAPPER_ENV]?.trim() ||
		DEFAULT_SECRETS_BIN
	);
}

/** Resolve and validate a dedicated access token for `reference`. */
export function resolveSecretToken(
	reference: string,
	options: ResolveSecretTokenOptions = {},
): string {
	if (typeof reference !== "string" || !SECRET_REFERENCE.test(reference)) {
		throw new Error(
			"matrix.tokenSecret must be a Matrix token secret key name (matrix-token or matrix-token-<lead>)",
		);
	}
	const env = options.env ?? process.env;
	const bin = secretsBin(env);
	const run = options.run ?? defaultRunner;

	let stdout: string;
	try {
		stdout = run(bin, ["get", reference]);
	} catch {
		// execFileSync's error.message may include captured stderr/secret output.
		// Do not interpolate any upstream error or captured output.
		throw new Error(
			`matrix: could not read secret "${reference}" through the configured wrapper; ` +
				"refusing to fall back to an inherited token",
		);
	}

	const token = stdout.replace(/\r?\n$/, "").trim();
	if (!ACCESS_TOKEN.test(token)) {
		throw new Error(
			`matrix: secret "${reference}" did not contain a usable access token; ` +
				"refusing to fall back to an inherited token",
		);
	}
	return token;
}

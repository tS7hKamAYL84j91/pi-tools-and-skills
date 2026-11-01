/**
 * Credential boundary for spawned child processes.
 *
 * Matrix credentials a child is never handed by default: supporting agents
 * and team-member one-shots are Matrix-suppressed (PI_PANOPTICON_PARENT_ID,
 * PI_MATRIX_DISABLED) and resolve their own secrets through the dedicated
 * tokenSecret path, so an inherited live credential is pure gratuitous
 * exposure. Key names only — no value inspection, so no regex ever touches
 * secret values.
 *
 * Scope, stated exactly: this is not an OS boundary between same-UID
 * processes (a hostile child can still read /proc/<parent>/environ). The
 * claim is only that a suppressed helper is not handed a Matrix credential
 * by default. Callers may opt out (e.g. user-configured gate commands whose
 * environment must stay byte-for-byte unchanged), which is an explicit,
 * auditable choice — not the default.
 */

/** Matrix credential key names stripped from child environments by default. */
export const CHILD_CREDENTIAL_ENV_KEYS = [
	"MATRIX_ACCESS_TOKEN",
	"MATRIX_BOT_PASSWORD",
	"MATRIX_RECOVERY_PASSPHRASE",
] as const;

/**
 * A fresh copy of `env` minus the Matrix credential keys. Never mutates the
 * passed object (which may be the caller's own record or process.env).
 */
export function stripChildCredentials(
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const child: NodeJS.ProcessEnv = { ...env };
	for (const key of CHILD_CREDENTIAL_ENV_KEYS) delete child[key];
	return child;
}

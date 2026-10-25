/**
 * Matrix test isolation from launch metadata.
 *
 * `loadMatrixConfig` deliberately returns null for a spawned subagent
 * (`PI_PANOPTICON_PARENT_ID`) or an explicit `PI_MATRIX_DISABLED`, so a child
 * agent never starts its own sync loop. Tests that exercise config loading must
 * not inherit either variable from the shell that launched them.
 */

const SUPPRESSION_ENV = ["PI_MATRIX_DISABLED", "PI_PANOPTICON_PARENT_ID"] as const;

/** Clear the suppression variables and return a restore function. */
export function isolateMatrixEnv(): () => void {
	const saved = SUPPRESSION_ENV.map((key) => [key, process.env[key]] as const);
	for (const key of SUPPRESSION_ENV) delete process.env[key];
	return () => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

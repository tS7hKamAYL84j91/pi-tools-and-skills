/**
 * Child credential-stripping helper: dummy-secret fixtures prove the helper
 * builds a fresh, credential-free copy without mutating the source env.
 * No live credentials are used anywhere here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CHILD_CREDENTIAL_ENV_KEYS,
	stripChildCredentials,
} from "../../lib/child-env.js";

const DUMMY_TOKEN = "syt_fixture_dummy_token_value_1122";
const DUMMY_PASSWORD = "fixture-dummy-pw-2468";
const DUMMY_RECOVERY = "fixture-dummy-recovery-1357";

const STRIPPED_KEYS = [
	"MATRIX_ACCESS_TOKEN",
	"MATRIX_BOT_PASSWORD",
	"MATRIX_RECOVERY_PASSPHRASE",
	"HUB_SIDEBAR_TOKEN",
] as const;

describe("stripChildCredentials", () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of STRIPPED_KEYS) {
			saved.set(key, process.env[key]);
			process.env[key] = `fixture-dummy-${key.toLowerCase()}-value`;
		}
	});

	afterEach(() => {
		for (const key of STRIPPED_KEYS) {
			const original = saved.get(key);
			if (original === undefined) delete process.env[key];
			else process.env[key] = original;
		}
	});

	it("pins the credential key list to Matrix names and the sidebar capability", () => {
		expect([...CHILD_CREDENTIAL_ENV_KEYS]).toEqual([...STRIPPED_KEYS]);
	});

	it("removes the credential keys from a copy and preserves everything else", () => {
		const source: NodeJS.ProcessEnv = {
			PATH: "/usr/bin:/bin",
			HOME: "/home/fixture",
			PI_PANOPTICON_PARENT_ID: "85747-fixture-lead",
			PI_PANOPTICON_NAMESPACE: "eo-agent-comms-gm",
			MATRIX_ACCESS_TOKEN: DUMMY_TOKEN,
			MATRIX_BOT_PASSWORD: DUMMY_PASSWORD,
			MATRIX_RECOVERY_PASSPHRASE: DUMMY_RECOVERY,
			HUB_SIDEBAR_TOKEN: "fixture-sidebar-capability",
		};
		const child = stripChildCredentials(source);
		for (const key of STRIPPED_KEYS) expect(child[key]).toBeUndefined();
		expect(child.PATH).toBe("/usr/bin:/bin");
		expect(child.HOME).toBe("/home/fixture");
		expect(child.PI_PANOPTICON_PARENT_ID).toBe("85747-fixture-lead");
		expect(child.PI_PANOPTICON_NAMESPACE).toBe("eo-agent-comms-gm");
		// The caller-owned source object is not mutated.
		expect(source.MATRIX_ACCESS_TOKEN).toBe(DUMMY_TOKEN);
		expect(source.MATRIX_BOT_PASSWORD).toBe(DUMMY_PASSWORD);
		expect(source.HUB_SIDEBAR_TOKEN).toBe("fixture-sidebar-capability");
	});

	it("strips credentials inherited from the real process env without mutating it", () => {
		const child = stripChildCredentials(process.env);
		for (const key of STRIPPED_KEYS) expect(child[key]).toBeUndefined();
		// Non-credential process env survives into the copy.
		expect(child.PATH).toBe(process.env.PATH);
		// process.env itself is untouched by the strip.
		expect(process.env.MATRIX_ACCESS_TOKEN).toBe(
			"fixture-dummy-matrix_access_token-value",
		);
	});

	it("never returns the same object it was given", () => {
		const source: NodeJS.ProcessEnv = { MATRIX_ACCESS_TOKEN: DUMMY_TOKEN };
		const child = stripChildCredentials(source);
		expect(child).not.toBe(source);
		expect(source.MATRIX_ACCESS_TOKEN).toBe(DUMMY_TOKEN);
	});
});

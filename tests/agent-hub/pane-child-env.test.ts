/**
 * Pins the pane-test child credential boundary: a spawned display/fixture
 * child is never handed a Matrix credential, and mirrors the production panel
 * argv with PI_MATRIX_DISABLED (2026-11-01 standard, key names only — the
 * planted values below are dummies, never real credentials).
 */
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { CHILD_CREDENTIAL_ENV_KEYS } from "../../lib/child-env.js";
import { paneChildEnv } from "./helpers.js";

const DUMMY = "dummy-not-a-real-credential";
const saved: Array<[key: string, original: string | undefined]> = [];

afterEach(() => {
	for (const [key, original] of saved) {
		if (original === undefined) delete process.env[key];
		else process.env[key] = original;
	}
	saved.length = 0;
});

/** Plant a dummy credential key, remembering the original for restore. */
function plant(key: string): void {
	saved.push([key, process.env[key]]);
	process.env[key] = DUMMY;
}

it("strips every Matrix credential key from the inherited environment", () => {
	for (const key of CHILD_CREDENTIAL_ENV_KEYS) plant(key);
	const env = paneChildEnv();
	for (const key of CHILD_CREDENTIAL_ENV_KEYS) expect(key in env).toBe(false);
});

it("mirrors the production panel argv with PI_MATRIX_DISABLED", () => {
	expect(paneChildEnv().PI_MATRIX_DISABLED).toBe("1");
});

it("applies explicit overrides without mutating process.env", () => {
	plant("MATRIX_ACCESS_TOKEN");
	const env = paneChildEnv({ PI_AGENTS_PANE_INTERVAL: "5" });
	expect(env.PI_AGENTS_PANE_INTERVAL).toBe("5");
	expect(env.MATRIX_ACCESS_TOKEN).toBeUndefined();
	expect(process.env.MATRIX_ACCESS_TOKEN).toBe(DUMMY);
});

it("a spawned child never sees the planted credential (end to end)", () => {
	plant("MATRIX_ACCESS_TOKEN");
	const seen = execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			"process.stdout.write(String('MATRIX_ACCESS_TOKEN' in process.env))",
		],
		{ encoding: "utf8", env: paneChildEnv() },
	);
	expect(seen).toBe("false");
});

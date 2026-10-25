/**
 * Dedicated Matrix credential: secret-store resolution and identity proof.
 *
 * A rendered profile can name `matrix.tokenSecret`. Resolution runs the existing
 * CoAS `coas-secrets get <ref>` wrapper, so argv carries only the reference, and a
 * dedicated credential must prove `whoami == userId` before the adapter syncs or
 * joins anything. Failure never falls back to an inherited shared token.
 *
 * Fixtures only: the runner/probe are injected, no real secret store, token,
 * homeserver or room.
 */

import { describe, expect, it, vi } from "vitest";

import {
	resolveSecretToken,
	SECRETS_BIN_ENV,
	SECRETS_WRAPPER_ENV,
} from "../secret-token.js";

const TOKEN = "fd_fixture_token_value_1234567890";

describe("resolveSecretToken", () => {
	it("passes only the secret reference on argv and returns the captured token", () => {
		const run = vi.fn(() => `${TOKEN}\n`);
		const env = { [SECRETS_BIN_ENV]: "/opt/coas/coas-secrets" };
		expect(resolveSecretToken("matrix-token-lead-a", { env, run })).toBe(TOKEN);
		expect(run).toHaveBeenCalledWith("/opt/coas/coas-secrets", ["get", "matrix-token-lead-a"]);
		// The token must never travel through argv.
		const argv = JSON.stringify(run.mock.calls[0]);
		expect(argv).not.toContain(TOKEN);
	});

	it("honours the existing wrapper override and default binary name", () => {
		const run = vi.fn(() => TOKEN);
		resolveSecretToken("matrix-token", { env: { [SECRETS_WRAPPER_ENV]: "/tmp/wrapper" }, run });
		expect(run).toHaveBeenLastCalledWith("/tmp/wrapper", ["get", "matrix-token"]);

		const run2 = vi.fn(() => TOKEN);
		resolveSecretToken("matrix-token", { env: {}, run: run2 });
		expect(run2).toHaveBeenLastCalledWith("coas-secrets", ["get", "matrix-token"]);
	});

	it("rejects option-like or shell-ish references before running anything", () => {
		const run = vi.fn(() => TOKEN);
		for (const bad of ["--get", "a b", "x;rm -rf /", "", "$(whoami)", "a/b"]) {
			expect(() => resolveSecretToken(bad, { run })).toThrow(/secret key name/);
		}
		expect(run).not.toHaveBeenCalled();
	});

	it("fails closed on a missing secret and never echoes captured output", () => {
		const run = vi.fn(() => {
			throw new Error("exit status 1");
		});
		let message = "";
		try {
			resolveSecretToken("matrix-token-lead-a", { run });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("refusing to fall back to an inherited token");
		expect(message).toContain("matrix-token-lead-a");
		expect(message).not.toContain(TOKEN);
	});

	it("rejects unusable secret content instead of using it", () => {
		const run = vi.fn(() => "   \n");
		expect(() => resolveSecretToken("matrix-token", { run })).toThrow(/usable access token/);

		const withSpace = vi.fn(() => "not a token with spaces");
		expect(() => resolveSecretToken("matrix-token", { run: withSpace })).toThrow(
			/usable access token/,
		);
	});
});

/**
 * Tests for the matrix extension.
 *
 * Covers the pure logic units that don't need a live Matrix server:
 *   - mxidLocalpart parsing
 *   - loadMatrixConfig validation, env-var resolution, and default handling
 *
 * The matrix-bot-sdk client itself is not exercised here — that needs a real
 * homeserver. Integration testing happens manually via SETUP.md Phase 2.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mxidLocalpart } from "../extensions/matrix/bridge.js";

// ── mxidLocalpart ───────────────────────────────────────────────

describe("mxidLocalpart", () => {
	it("strips the leading @ and homeserver suffix", () => {
		expect(mxidLocalpart("@jim:matrix.org")).toBe("jim");
	});

	it("handles dotted localparts", () => {
		expect(mxidLocalpart("@jim.smith:matrix.org")).toBe("jim.smith");
	});

	it("handles private hostnames", () => {
		expect(mxidLocalpart("@jim:matrix.tail12345.ts.net")).toBe("jim");
	});

	it("returns the input unchanged when no colon is present", () => {
		expect(mxidLocalpart("@bare")).toBe("bare");
	});

	it("returns the input without the @ when no colon is present", () => {
		expect(mxidLocalpart("nonstandard")).toBe("nonstandard");
	});
});

// ── loadMatrixConfig ────────────────────────────────────────────

describe("loadMatrixConfig", () => {
	let tmpDir: string;
	let projectSettingsPath: string;
	let prevToken: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "matrix-config-test-"));
		projectSettingsPath = join(tmpDir, "settings.json");
		prevToken = process.env.MATRIX_TEST_TOKEN;
		process.env.MATRIX_TEST_TOKEN = "syt_test_token";
	});

	afterEach(() => {
		if (prevToken === undefined) delete process.env.MATRIX_TEST_TOKEN;
		else process.env.MATRIX_TEST_TOKEN = prevToken;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeSettings(matrix: Record<string, unknown>): void {
		writeFileSync(projectSettingsPath, JSON.stringify({ matrix }), "utf-8");
	}

	it("returns null when no matrix block is configured", async () => {
		writeFileSync(projectSettingsPath, JSON.stringify({}), "utf-8");
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(loadMatrixConfig(projectSettingsPath)).toBeNull();
	});

	it("returns null when settings.json does not exist", async () => {
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(loadMatrixConfig(join(tmpDir, "nope.json"))).toBeNull();
	});

	it("loads a complete config with all required fields and resolves the token from env", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "!room:matrix.org",

			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);

		expect(config).not.toBeNull();
		expect(config?.homeserver).toBe("https://matrix.org");
		expect(config?.userId).toBe("@agent-bot:matrix.org");
		expect(config?.roomId).toBe("!room:matrix.org");

		expect(config?.accessToken).toBe("syt_test_token");
	});

	it("throws when a required field is missing", async () => {
		writeSettings({
			userId: "@agent-bot:matrix.org",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/homeserver/);
	});

	it("throws when userId is not a Matrix MXID", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "agent-bot",
			roomId: "!room:matrix.org",

			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/MXID/);
	});

	it("throws when roomId is not a Matrix room ID", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "room:matrix.org",

			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/room ID/);
	});

	it("throws when the access token env var is not set", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "!room:matrix.org",

			accessTokenEnv: "MATRIX_THIS_VAR_IS_NOT_SET_DELIBERATELY",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(
			/MATRIX_THIS_VAR_IS_NOT_SET_DELIBERATELY/,
		);
	});
});

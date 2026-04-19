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

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
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

	it("handles tailnet hostnames", () => {
		expect(mxidLocalpart("@jim:coas-matrix.tail12345.ts.net")).toBe("jim");
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
	let prevPassphrase: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "matrix-config-test-"));
		projectSettingsPath = join(tmpDir, "settings.json");
		prevToken = process.env.MATRIX_TEST_TOKEN;
		prevPassphrase = process.env.MATRIX_TEST_RECOVERY;
		process.env.MATRIX_TEST_TOKEN = "syt_test_token";
	});

	afterEach(() => {
		if (prevToken === undefined) delete process.env.MATRIX_TEST_TOKEN;
		else process.env.MATRIX_TEST_TOKEN = prevToken;
		if (prevPassphrase === undefined) delete process.env.MATRIX_TEST_RECOVERY;
		else process.env.MATRIX_TEST_RECOVERY = prevPassphrase;
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
			userId: "@coas-bot:matrix.org",
			roomId: "!room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);

		expect(config).not.toBeNull();
		expect(config?.homeserver).toBe("https://matrix.org");
		expect(config?.userId).toBe("@coas-bot:matrix.org");
		expect(config?.roomId).toBe("!room:matrix.org");
		expect(config?.targetAgent).toBe("coas");
		expect(config?.accessToken).toBe("syt_test_token");
		expect(config?.encryption).toBe(true); // default
	});

	it("throws when a required field is missing", async () => {
		writeSettings({
			userId: "@coas-bot:matrix.org",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/homeserver/);
	});

	it("throws when userId is not a Matrix MXID", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "coas-bot",
			roomId: "!room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/MXID/);
	});

	it("throws when roomId is not a Matrix room ID", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@coas-bot:matrix.org",
			roomId: "room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/room ID/);
	});

	it("throws when the access token env var is not set", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@coas-bot:matrix.org",
			roomId: "!room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_THIS_VAR_IS_NOT_SET_DELIBERATELY",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/MATRIX_THIS_VAR_IS_NOT_SET_DELIBERATELY/);
	});

	it("resolves the optional Secure Backup passphrase env var when configured", async () => {
		process.env.MATRIX_TEST_RECOVERY = "passphrase-here";
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@coas-bot:matrix.org",
			roomId: "!room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
			secureBackupEnv: "MATRIX_TEST_RECOVERY",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);
		expect(config?.recoveryPassphrase).toBe("passphrase-here");
	});

	it("respects encryption: false override", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@coas-bot:matrix.org",
			roomId: "!room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
			encryption: false,
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);
		expect(config?.encryption).toBe(false);
	});

	it("expands ~/ in cryptoStorePath", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@coas-bot:matrix.org",
			roomId: "!room:matrix.org",
			targetAgent: "coas",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
			cryptoStorePath: "~/test-matrix-store",
		});
		const { loadMatrixConfig } = await import("../extensions/matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);
		expect(config?.cryptoStorePath.startsWith("/")).toBe(true);
		expect(config?.cryptoStorePath.endsWith("/test-matrix-store")).toBe(true);
	});
});

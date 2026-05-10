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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mxidLocalpart } from "../extensions/pi-matrix/bridge.js";
import { extractMatrixAttachment } from "../extensions/pi-matrix/attachments.js";
import { MatrixBridgeClient } from "../extensions/pi-matrix/client.js";
import { MatrixTransport } from "../extensions/pi-matrix/transport.js";
import type { MatrixConfig } from "../extensions/pi-matrix/types.js";
import type { MatrixDownloadClient } from "../extensions/pi-matrix/attachments.js";

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
		writeFileSync(projectSettingsPath, JSON.stringify({ "pi-matrix": matrix }), "utf-8");
	}

	it("returns null when no matrix block is configured", async () => {
		writeFileSync(projectSettingsPath, JSON.stringify({}), "utf-8");
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(loadMatrixConfig(projectSettingsPath)).toBeNull();
	});

	it("returns null when settings.json does not exist", async () => {
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(loadMatrixConfig(join(tmpDir, "nope.json"))).toBeNull();
	});

	it("loads a complete config with all required fields and resolves the token from env", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "!room:matrix.org",

			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);

		expect(config).not.toBeNull();
		expect(config?.homeserver).toBe("https://matrix.org");
		expect(config?.userId).toBe("@agent-bot:matrix.org");
		expect(config?.roomId).toBe("!room:matrix.org");
		expect(config?.attachmentCachePath).toContain("matrix-attachments");
		expect(config?.maxAttachmentBytes).toBe(25 * 1024 * 1024);
		expect(config?.allowedMimePrefixes).toContain("image/");

		expect(config?.accessToken).toBe("syt_test_token");
	});

	it("loads custom attachment settings", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "!room:matrix.org",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
			attachmentCachePath: "~/matrix-cache-test",
			maxAttachmentBytes: 1024,
			allowedMimePrefixes: ["image/png", "application/pdf"],
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		const config = loadMatrixConfig(projectSettingsPath);

		expect(config?.attachmentCachePath).toContain("matrix-cache-test");
		expect(config?.maxAttachmentBytes).toBe(1024);
		expect(config?.allowedMimePrefixes).toEqual(["image/png", "application/pdf"]);
	});

	it("throws when maxAttachmentBytes is invalid", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "!room:matrix.org",
			accessTokenEnv: "MATRIX_TEST_TOKEN",
			maxAttachmentBytes: 0,
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/maxAttachmentBytes/);
	});

	it("throws when a required field is missing", async () => {
		writeSettings({
			userId: "@agent-bot:matrix.org",
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/homeserver/);
	});

	it("throws when userId is not a Matrix MXID", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "agent-bot",
			roomId: "!room:matrix.org",

			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/MXID/);
	});

	it("throws when roomId is not a Matrix room ID", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "room:matrix.org",

			accessTokenEnv: "MATRIX_TEST_TOKEN",
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(/room ID/);
	});

	it("throws when the access token env var is not set", async () => {
		writeSettings({
			homeserver: "https://matrix.org",
			userId: "@agent-bot:matrix.org",
			roomId: "!room:matrix.org",

			accessTokenEnv: "MATRIX_THIS_VAR_IS_NOT_SET_DELIBERATELY",
		});
		const { loadMatrixConfig } = await import("../extensions/pi-matrix/config.js");
		expect(() => loadMatrixConfig(projectSettingsPath)).toThrow(
			/MATRIX_THIS_VAR_IS_NOT_SET_DELIBERATELY/,
		);
	});
});

// ── attachments ────────────────────────────────────────────────

function makeAttachmentConfig(attachmentCachePath: string, overrides: Partial<MatrixConfig> = {}): MatrixConfig {
	return {
		homeserver: "https://matrix.org",
		userId: "@agent-bot:matrix.org",
		roomId: "!room:matrix.org",
		accessToken: "syt_test_token",
		storagePath: attachmentCachePath,
		attachmentCachePath,
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: ["image/", "application/pdf", "text/"],
		channelLabel: "matrix",
		trustedSenders: ["@user:matrix.org"],
		...overrides,
	};
}

function makeDownloadClient(): MatrixDownloadClient {
	return {};
}

function mockFetchResponse(data = "file-bytes", contentType = "image/png", contentLength?: string): ReturnType<typeof vi.fn> {
	const headers = new Headers({ "content-type": contentType });
	if (contentLength !== undefined) headers.set("content-length", contentLength);
	const fetchMock = vi.fn(async () => new Response(data, { status: 200, headers }));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("Matrix attachment extraction", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "matrix-attachment-test-"));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("downloads image events to a sanitized local cache path", async () => {
		const config = makeAttachmentConfig(tmpDir);
		const client = makeDownloadClient();
		const fetchMock = mockFetchResponse("png", "image/png");
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/image",
			origin_server_ts: 123,
			content: {
				msgtype: "m.image",
				body: "../kitten.png",
				url: "mxc://matrix.org/media-id",
				info: { mimetype: "image/png", size: 3 },
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://matrix.org/_matrix/client/v1/media/download/matrix.org/media-id?allow_remote=true",
			expect.objectContaining({ headers: { Authorization: "Bearer syt_test_token" } }),
		);
		expect(attachment?.filename).toBe("kitten.png");
		expect(attachment?.localPath).toContain(tmpDir);
		expect(attachment?.mxcUrl).toBe("mxc://matrix.org/media-id");
		expect(attachment?.eventId).toBe("$event/image");
		expect(attachment?.error).toBeUndefined();
		expect(readFileSync(attachment?.localPath ?? "", "utf8")).toBe("png");
	});

	it("surfaces disallowed MIME types without downloading", async () => {
		const config = makeAttachmentConfig(tmpDir, { allowedMimePrefixes: ["application/pdf"] });
		const client = makeDownloadClient();
		const fetchMock = mockFetchResponse();
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/js",
			content: {
				msgtype: "m.file",
				body: "script.js",
				url: "mxc://matrix.org/script",
				info: { mimetype: "application/javascript", size: 10 },
			},
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(attachment?.localPath).toBeUndefined();
		expect(attachment?.error).toContain("MIME type not allowed");
	});

	it("surfaces oversize declared attachments without downloading", async () => {
		const config = makeAttachmentConfig(tmpDir, { maxAttachmentBytes: 4 });
		const client = makeDownloadClient();
		const fetchMock = mockFetchResponse();
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/big",
			content: {
				msgtype: "m.file",
				body: "big.pdf",
				url: "mxc://matrix.org/big",
				info: { mimetype: "application/pdf", size: 5 },
			},
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(attachment?.error).toContain("maxAttachmentBytes");
	});

	it("surfaces oversize downloaded attachments without writing", async () => {
		const config = makeAttachmentConfig(tmpDir, { maxAttachmentBytes: 4 });
		const client = makeDownloadClient();
		mockFetchResponse("12345", "application/pdf");
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/lying-size",
			content: {
				msgtype: "m.file",
				body: "small.pdf",
				url: "mxc://matrix.org/lying-size",
				info: { mimetype: "application/pdf", size: 3 },
			},
		});

		expect(attachment?.localPath).toBeUndefined();
		expect(attachment?.error).toContain("maxAttachmentBytes");
		expect(existsSync(join(tmpDir, "!room_matrix.org"))).toBe(false);
	});

	it("rejects missing response MIME when allowlist is configured", async () => {
		const config = makeAttachmentConfig(tmpDir, { allowedMimePrefixes: ["image/"] });
		const client = makeDownloadClient();
		mockFetchResponse("bytes", "application/octet-stream");
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/no-mime",
			content: {
				msgtype: "m.image",
				body: "photo",
				url: "mxc://matrix.org/no-mime",
				info: { size: 4 },
			},
		});

		expect(attachment?.localPath).toBeUndefined();
		expect(attachment?.error).toContain("MIME type not allowed");
	});

	it("requires exact matches for concrete MIME allowlist entries", async () => {
		const config = makeAttachmentConfig(tmpDir, { allowedMimePrefixes: ["application/pdf"] });
		const client = makeDownloadClient();
		const fetchMock = mockFetchResponse();
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/fake-pdf",
			content: {
				msgtype: "m.file",
				body: "fake.pdf",
				url: "mxc://matrix.org/fake-pdf",
				info: { mimetype: "application/pdf-malicious", size: 4 },
			},
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(attachment?.error).toContain("MIME type not allowed");
	});

	it("defers encrypted media even when the SDK crypto helper is available", async () => {
		const config = makeAttachmentConfig(tmpDir, { allowedMimePrefixes: ["application/octet-stream"] });
		const decryptMedia = vi.fn(async () => Buffer.from("decrypted"));
		const client: MatrixDownloadClient = {
			crypto: { decryptMedia },
		};
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/secret",
			content: {
				msgtype: "m.file",
				body: "secret.bin",
				file: { url: "mxc://matrix.org/encrypted" },
				info: { mimetype: "application/octet-stream", size: 9 },
			},
		});

		expect(decryptMedia).not.toHaveBeenCalled();
		expect(attachment?.encrypted).toBe(true);
		expect(attachment?.localPath).toBeUndefined();
		expect(attachment?.error).toContain("bounded download path");
	});

	it("surfaces encrypted media as an error when crypto is unavailable", async () => {
		const config = makeAttachmentConfig(tmpDir, { allowedMimePrefixes: ["application/octet-stream"] });
		const client = makeDownloadClient();
		const attachment = await extractMatrixAttachment(config, client, "!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/no-crypto",
			content: {
				msgtype: "m.file",
				body: "secret.bin",
				file: { url: "mxc://matrix.org/encrypted" },
				info: { mimetype: "application/octet-stream", size: 9 },
			},
		});

		expect(attachment?.localPath).toBeUndefined();
		expect(attachment?.error).toContain("Encrypted Matrix media download is deferred");
	});
});

// ── inbound message and transport compatibility ────────────────

describe("Matrix inbound message handling", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps text messages backwards compatible", async () => {
		const client = new MatrixBridgeClient(makeAttachmentConfig("/tmp"));
		const msg = await client.buildInboundMessage("!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/text",
			origin_server_ts: 42,
			content: { msgtype: "m.text", body: "hello" },
		});

		expect(msg).toEqual({
			roomId: "!room:matrix.org",
			senderMxid: "@user:matrix.org",
			body: "hello",
			eventId: "$event/text",
			timestampMs: 42,
			attachments: undefined,
		});
	});

	it("builds media messages with attachment error metadata", async () => {
		const client = new MatrixBridgeClient(makeAttachmentConfig("/tmp", { allowedMimePrefixes: ["application/pdf"] }));
		const fetchMock = mockFetchResponse();
		const msg = await client.buildInboundMessage("!room:matrix.org", {
			sender: "@user:matrix.org",
			event_id: "$event/media-error",
			origin_server_ts: 43,
			content: {
				msgtype: "m.image",
				body: "photo.png",
				url: "mxc://matrix.org/photo",
				info: { mimetype: "image/png", size: 5 },
			},
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(msg?.body).toBe("photo.png");
		expect(msg?.attachments?.[0]?.error).toContain("MIME type not allowed");
	});

	it("preserves attachment records through MatrixTransport", () => {
		const transport = new MatrixTransport({} as MatrixBridgeClient);
		transport.pushInbound({
			roomId: "!room:matrix.org",
			senderMxid: "@user:matrix.org",
			body: "see file",
			eventId: "$event/file",
			timestampMs: 55,
			attachments: [{
				kind: "file",
				filename: "doc.pdf",
				mimeType: "application/pdf",
				sizeBytes: 12,
				localPath: "/tmp/doc.pdf",
				mxcUrl: "mxc://matrix.org/doc",
				eventId: "$event/file",
			}],
		});

		const messages = transport.receive("agent-id");
		expect(messages[0]?.text).toBe("see file");
		expect(messages[0]?.attachments?.[0]?.localPath).toBe("/tmp/doc.pdf");
	});
});

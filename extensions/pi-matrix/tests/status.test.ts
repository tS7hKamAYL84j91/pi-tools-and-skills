/** Matrix diagnostic and attachment-recovery regression tests. */

import { describe, expect, it } from "vitest";

import { extractMatrixAttachment } from "../attachments.js";
import {
	classifyMatrixConfigError,
	matrixDiagnosticSummary,
	matrixStatusText,
	sanitizeMatrixError,
} from "../status.js";
import type { MatrixConfig } from "../types.js";

function makeConfig(overrides: Partial<MatrixConfig> = {}): MatrixConfig {
	return {
		homeserver: "https://matrix.example",
		userId: "@bot:example",
		roomId: "!room:example",
		accessToken: "token",
		storagePath: "/tmp/matrix-sync",
		attachmentCachePath: "/tmp/matrix-attachments",
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: ["image/"],
		channelLabel: "matrix",
		trustedSenders: ["@owner:example"],
		allowAnySender: false,
		ingress: {},
		...overrides,
	};
}

describe("Matrix status diagnostics", () => {
	it("renders distinct compact connection states", () => {
		const base = { config: null, unreadCount: 0, lastError: null };
		expect(matrixStatusText({ ...base, state: "not_configured" })).toBe("pi-matrix: not configured");
		expect(matrixStatusText({ ...base, state: "token_unavailable" })).toBe("pi-matrix: token unavailable");
		expect(matrixStatusText({ ...base, state: "connecting" })).toBe("pi-matrix: connecting");
		expect(matrixStatusText({ ...base, state: "connected", unreadCount: 2 })).toBe("pi-matrix: connected msg:2");
		expect(matrixStatusText({ ...base, state: "disconnected", unreadCount: 2 })).toBe("pi-matrix: disconnected msg:2");
		expect(matrixStatusText({ ...base, state: "error" })).toBe("pi-matrix: error");
	});

	it("preserves deny-by-default sender policy and redacts diagnostic secrets", () => {
		const summary = matrixDiagnosticSummary({
			config: makeConfig({ trustedSenders: [], allowAnySender: false }),
			state: "error",
			unreadCount: 3,
			lastError: "HTTP 401 for Bearer syt_secret_token",
		});

		expect(summary).toContain("sender policy: deny all senders");
		expect(summary).toContain("unread: 3");
		expect(summary).toContain("run /reload");
		expect(summary).not.toContain("syt_secret_token");
		expect(classifyMatrixConfigError('matrix: env var "MATRIX_TOKEN" is not set.')).toBe("token_unavailable");
		const terminalControlSequence = `${String.fromCharCode(27)}[31m${String.fromCharCode(7)}`;
		const tokenLikeValue = ["syt", "secret", "token"].join("_");
		expect(sanitizeMatrixError(`accessToken=${tokenLikeValue} Bearer abc.def${terminalControlSequence}`)).toBe(
			"accessToken=[redacted] Bearer [redacted]",
		);
	});
});

describe("Matrix attachment recovery feedback", () => {
	it("includes safe metadata and a recovery action when MIME policy rejects a file", async () => {
		const attachment = await extractMatrixAttachment(
			makeConfig(),
			{},
			"!room:example",
			{
				event_id: "$event",
				content: {
					body: "script.js",
					msgtype: "m.file",
					url: "mxc://example/media",
					info: { mimetype: "application/javascript", size: 24 },
				},
			},
		);

		expect(attachment?.localPath).toBeUndefined();
		expect(attachment?.error).toContain('Attachment "script.js" (application/javascript, 24 B) was skipped');
		expect(attachment?.error).toContain("MIME type not allowed");
		expect(attachment?.error).toContain("Next action:");
	});
});

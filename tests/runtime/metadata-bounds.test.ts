/**
 * Descriptive metadata is bounded on both the write and the read boundary.
 *
 * The send tools cap metadata at 256 characters, but a mailbox writer (the
 * stated Maildir threat model) does not go through them. Without a shared
 * bound, a 200 KB `inReplyTo` would be stored and then echoed to the model by
 * `message_read`. The policy is one shared limit, applied by the normalizer
 * that both `durableWrite` and the stored-envelope reader use.
 */
import {
	beforeEach,
	describe,
	expect,
	it,
	type MockedFunction,
	vi,
} from "vitest";

vi.mock("../../lib/agent-registry.js", () => ({
	REGISTRY_DIR: "/fake/.pi/agents",
	ensureRegistryDir: vi.fn(),
}));

vi.mock("node:fs", () => ({
	constants: { O_WRONLY: 1, O_CREAT: 64, O_EXCL: 128, O_NOFOLLOW: 131072 },
	mkdirSync: vi.fn(),
	chmodSync: vi.fn(),
	closeSync: vi.fn(),
	openSync: vi.fn(() => 1),
	lstatSync: vi.fn(() => ({ mode: 0o600, isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true })),
	writeFileSync: vi.fn(),
	readFileSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	renameSync: vi.fn(),
	unlinkSync: vi.fn(),
	rmSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
	randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import * as nodefs from "node:fs";
import {
	MESSAGE_METADATA_MAX_LENGTH,
	metadataString,
	normalizeMessageMetadata,
} from "../../lib/message-transport.js";
import { durableWrite } from "../../lib/transports/maildir.js";

const writeFileSyncMock = nodefs.writeFileSync as MockedFunction<typeof nodefs.writeFileSync>;

function longValue(): string {
	return "x".repeat(MESSAGE_METADATA_MAX_LENGTH + 1);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("metadata length bound", () => {
	it("keeps a value at the limit and drops one over it", () => {
		expect(metadataString("x".repeat(MESSAGE_METADATA_MAX_LENGTH))).toHaveLength(
			MESSAGE_METADATA_MAX_LENGTH,
		);
		expect(metadataString(longValue())).toBeUndefined();
	});

	it("still trims and treats blank as absent", () => {
		expect(metadataString("  value  ")).toBe("value");
		expect(metadataString("   ")).toBeUndefined();
		expect(metadataString(42)).toBeUndefined();
	});

	it("drops over-long descriptive fields instead of truncating them", () => {
		const normalized = normalizeMessageMetadata({
			inReplyTo: longValue(),
			correlationId: longValue(),
			type: "request",
		});
		// A partial identifier is worse than none: the over-long fields disappear.
		expect(normalized).toEqual({ type: "request" });
	});

	it("does not persist over-long metadata from a mailbox write", () => {
		const result = durableWrite("target-1", "foreign-writer", "hi", {
			mailboxPath: "/fake/mailbox",
			inReplyTo: longValue(),
			correlationId: longValue(),
		});
		expect(result.accepted).toBe(true);

		const persisted = writeFileSyncMock.mock.calls
			.map((call) => String(call[1]))
			.join("\n");
		expect(persisted).toContain('"text":"hi"');
		expect(persisted).not.toContain(longValue());
		expect(persisted).not.toContain("inReplyTo");
		expect(persisted).not.toContain("correlationId");
	});
});
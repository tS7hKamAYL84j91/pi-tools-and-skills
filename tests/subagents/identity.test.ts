import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripChildCredentials } from "../../lib/child-env.js";

vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return { ...fs, openSync: vi.fn(fs.openSync), fstatSync: vi.fn(fs.fstatSync), readSync: vi.fn(fs.readSync) };
});

const paths = vi.hoisted(() => ({ registry: "" }));
vi.mock("../../lib/agent-registry.js", async (importOriginal) => ({
	...await importOriginal<typeof import("../../lib/agent-registry.js")>(),
	get REGISTRY_DIR() { return paths.registry; },
}));
import { findCurrentAgentIdentity } from "../../lib/agent-identity.js";

const sessionFile = "/tmp/session.jsonl";
function record(file: string, overrides: Record<string, unknown> = {}): void {
	writeFileSync(join(paths.registry, file), JSON.stringify({
		id: "parent", name: "alias", pid: process.pid, sessionFile,
		declared_name: "lead", namespace: "original-lead", ...overrides,
	}), { mode: 0o600 });
}

beforeEach(() => {
	vi.resetAllMocks();
	paths.registry = mkdtempSync(join(tmpdir(), "subagents-identity-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(paths.registry, { recursive: true, force: true });
});

describe("optional Agent Hub routing identity", () => {
	it("returns null without a registry", () => {
		rmSync(paths.registry, { recursive: true });
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
	});

	it("matches current PID and session, ignoring old sessions, peers, and corrupt files", () => {
		record("old.json", { id: "old", sessionFile: "/tmp/old.jsonl" });
		record("peer.json", { id: "peer", pid: process.pid + 1 });
		writeFileSync(join(paths.registry, "corrupt.json"), "not json", { mode: 0o600 });
		record("current.json", { task: "private task", sessionDir: "/private" });
		expect(findCurrentAgentIdentity(sessionFile)).toEqual({ id: "parent", name: "alias", declared_name: "lead", namespace: "original-lead" });
	});

	it("fails closed on ambiguous identities", () => {
		record("one.json");
		record("two.json", { id: "other" });
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
	});

	it("supports ephemeral sessions without borrowing a persisted session identity", () => {
		record("persisted.json");
		expect(findCurrentAgentIdentity(undefined)).toBeNull();
		record("ephemeral.json", { sessionFile: undefined });
		expect(findCurrentAgentIdentity(undefined)?.id).toBe("parent");
	});

	it("rejects symlinked records without changing the link or target", () => {
		record("target");
		const link = join(paths.registry, "linked.json");
		symlinkSync(join(paths.registry, "target"), link);
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
		expect(statSync(join(paths.registry, "target")).mode & 0o777).toBe(0o600);
	});

	it("refuses a symlink swapped in after metadata checks", async () => {
		record("current.json");
		record("target");
		const path = join(paths.registry, "current.json");
		const original = await vi.importActual<typeof import("node:fs")>("node:fs");
		vi.mocked(fs.openSync).mockImplementationOnce((file, flags, mode) => {
			fs.unlinkSync(path);
			symlinkSync(join(paths.registry, "target"), path);
			return original.openSync(file, flags, mode);
		});
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(fs.openSync).toHaveBeenCalledWith(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
		expect(fs.readSync).not.toHaveBeenCalled();
	});

	it.each(["directory", "nonprivate file"])("rechecks the opened descriptor after a race to %s", async (replacement) => {
		record("current.json");
		const path = join(paths.registry, "current.json");
		const original = await vi.importActual<typeof import("node:fs")>("node:fs");
		vi.mocked(fs.openSync).mockImplementationOnce((file, flags, mode) => {
			if (replacement === "directory") {
				fs.unlinkSync(path);
				mkdirSync(path, { mode: 0o700 });
			} else chmodSync(path, 0o644);
			return original.openSync(file, flags, mode);
		});
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(fs.readSync).not.toHaveBeenCalled();
	});

	it("rejects a symlinked registry directory", () => {
		mkdirSync(join(paths.registry, "real"), { mode: 0o700 });
		const link = join(paths.registry, "linked");
		symlinkSync(join(paths.registry, "real"), link);
		const original = paths.registry;
		try {
			paths.registry = link;
			expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		} finally { paths.registry = original; }
	});

	it.each([0o644, 0o640, 0o400])("ignores a record with mode %s without repairing it", (mode) => {
		record("current.json");
		const path = join(paths.registry, "current.json");
		chmodSync(path, mode);
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(statSync(path).mode & 0o777).toBe(mode);
	});

	it("rejects a nonprivate registry directory without chmod", () => {
		record("current.json");
		chmodSync(paths.registry, 0o755);
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(statSync(paths.registry).mode & 0o777).toBe(0o755);
	});

	it("ignores nonregular records", () => {
		mkdirSync(join(paths.registry, "directory.json"), { mode: 0o700 });
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
	});

	it.skipIf(process.platform === "win32")("ignores a FIFO without opening or blocking on it", () => {
		const path = join(paths.registry, "fifo.json");
		const fifo = spawnSync("mkfifo", ["-m", "600", path], { env: stripChildCredentials(process.env) });
		expect(fifo.status).toBe(0);
		const open = vi.mocked(fs.openSync);
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(open).not.toHaveBeenCalled();
	});

	it("accepts the 64 KiB boundary but never reads oversized records", () => {
		record("current.json");
		const path = join(paths.registry, "current.json");
		const content = readFileSync(path, "utf8").padEnd(64 * 1024, " ");
		writeFileSync(path, content);
		expect(findCurrentAgentIdentity(sessionFile)?.id).toBe("parent");
		writeFileSync(path, `${content} `);
		const read = vi.mocked(fs.readSync).mockClear();
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(read).not.toHaveBeenCalled();
	});

	it("bounds reads when a record grows after the descriptor size check", async () => {
		record("current.json");
		const path = join(paths.registry, "current.json");
		const original = await vi.importActual<typeof import("node:fs")>("node:fs");
		vi.mocked(fs.fstatSync).mockImplementationOnce((fd) => {
			const stat = original.fstatSync(fd);
			fs.appendFileSync(path, " ".repeat(128 * 1024));
			return stat;
		});
		const read = vi.mocked(fs.readSync);
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		expect(read.mock.results.reduce((total, result) => total + Number(result.value), 0)).toBe(64 * 1024 + 1);
	});

	it("drops malformed identities and namespace claims", () => {
		record("invalid.json", { id: 123 });
		expect(findCurrentAgentIdentity(sessionFile)).toBeNull();
		record("valid.json", { namespace: "../unsafe" });
		expect(findCurrentAgentIdentity(sessionFile)?.namespace).toBeUndefined();
	});
});

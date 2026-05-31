/** Tests for private local IPC path metadata hardening. */

import { chmodSync, closeSync, mkdtempSync, openSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PRIVATE_DIR_MODE,
	PRIVATE_FILE_MODE,
	assertPrivateFileForRead,
	assertPrivateFileTarget,
	auditPrivateDirectory,
	auditPrivateFile,
	ensurePrivateDirectory,
	setPrivateFileMode,
	writeNewPrivateFileSync,
} from "../../lib/private-local-mode.js";

describe("private local IPC path hardening", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-private-local-mode-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates private IPC directories as 0700", () => {
		const registryDir = join(tmpDir, "agents");

		ensurePrivateDirectory(registryDir);

		expect(auditPrivateDirectory(registryDir)).toMatchObject({
			exists: true,
			ok: true,
			kind: "directory",
			mode: PRIVATE_DIR_MODE,
		});
	});

	it("reports fail-closed directory modes", () => {
		const registryDir = join(tmpDir, "agents");
		ensurePrivateDirectory(registryDir);
		chmodSync(registryDir, 0o755);

		expect(auditPrivateDirectory(registryDir)).toMatchObject({
			ok: false,
			mode: 0o755,
			error: "directory mode must be 0700",
		});
	});

	it("sets private IPC files to 0600 and audits permissive files", () => {
		const recordPath = join(tmpDir, "agent.json");
		closeSync(openSync(recordPath, "w", 0o644));

		expect(auditPrivateFile(recordPath)).toMatchObject({ ok: false, mode: 0o644 });

		setPrivateFileMode(recordPath);

		expect(auditPrivateFile(recordPath)).toMatchObject({
			ok: true,
			kind: "file",
			mode: PRIVATE_FILE_MODE,
		});
		expect(() => assertPrivateFileForRead(recordPath)).not.toThrow();
	});

	it("rejects symlinked registry/maildir directories", () => {
		const target = join(tmpDir, "target");
		const link = join(tmpDir, "agents");
		ensurePrivateDirectory(target);
		symlinkSync(target, link, "dir");

		expect(auditPrivateDirectory(link)).toMatchObject({
			ok: false,
			error: "path must not be a symlink",
		});
		expect(() => ensurePrivateDirectory(link)).toThrow(/symlink/);
	});

	it("rejects symlinked parent IPC path components", () => {
		const target = join(tmpDir, "target");
		const link = join(tmpDir, "pi-link");
		ensurePrivateDirectory(target);
		symlinkSync(target, link, "dir");

		expect(() => ensurePrivateDirectory(join(link, "agents"))).toThrow(/symlink/);
		expect(() => assertPrivateFileTarget(join(link, "agents", "agent.json"))).toThrow(/symlink/);
	});

	it("rejects symlinked registry/message files", () => {
		const target = join(tmpDir, "target.json");
		const link = join(tmpDir, "agent.json");
		closeSync(openSync(target, "w", 0o600));
		symlinkSync(target, link);

		expect(auditPrivateFile(link)).toMatchObject({
			ok: false,
			error: "path must not be a symlink",
		});
		expect(() => assertPrivateFileForRead(link)).toThrow(/symlink/);
		expect(() => assertPrivateFileTarget(link)).toThrow(/symlink/);
	});

	it("writes new private files without following final symlink targets", () => {
		const recordPath = join(tmpDir, "agent.json");
		const target = join(tmpDir, "target.json");
		const link = join(tmpDir, "link.json");
		closeSync(openSync(target, "w", 0o600));
		symlinkSync(target, link);

		writeNewPrivateFileSync(recordPath, "{}");

		expect(auditPrivateFile(recordPath)).toMatchObject({ ok: true, mode: PRIVATE_FILE_MODE });
		expect(() => writeNewPrivateFileSync(link, "{}")).toThrow(/symlink|EEXIST/);
	});

	it("allows missing private file targets but rejects existing symlink targets before write", () => {
		const missing = join(tmpDir, "missing.json");
		const target = join(tmpDir, "target.json");
		const link = join(tmpDir, "link.json");
		closeSync(openSync(target, "w", 0o600));
		symlinkSync(target, link);

		expect(() => assertPrivateFileTarget(missing)).not.toThrow();
		expect(() => assertPrivateFileTarget(link)).toThrow(/symlink/);
	});
});

/**
 * Smoke test for the coas-daemon bootstrap lifecycle (T-867 final slice):
 * lock -> key bootstrap -> 0600 socket publication -> graceful stop releasing
 * the lock; second instance fails closed while the first is live.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapDaemon } from "../../daemon/src/main.js";
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from "../../daemon/src/lock.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-main-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

describe("bootstrapDaemon lifecycle", () => {
	it("starts with a 0600 socket, audits start/stop, and releases the lock on stop", async () => {
		const roots = await makeRoots();
		try {
			const daemon = await bootstrapDaemon(roots);
			expect(daemon.posture).toBe("same_uid_untrusted");
			expect(daemon.keyId).toMatch(/coas-daemon-integrity/);

			const info = await stat(daemon.socketPath);
			expect(info.isSocket()).toBe(true);
			expect(info.mode & 0o777).toBe(0o600);

			// Second instance fails closed while the first is live.
			await expect(bootstrapDaemon(roots)).rejects.toThrow(/single-instance lock/);

			await daemon.stop();

			// After stop the lock is released and a fresh instance may start.
			const reacquire = await acquireSingleInstanceLock(roots);
			expect(reacquire.acquired).toBe(true);
			await releaseSingleInstanceLock(roots);

			const logDir = join(roots.stateRoot, "audit");
			const files = await readdir(logDir);
			const log = await readFile(join(logDir, files[0] ?? ""), "utf8");
			expect(log).toContain("daemon_started");
			expect(log).toContain("daemon_stopped");
		} finally {
			await rm(roots.runtimeRoot, { recursive: true, force: true });
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});
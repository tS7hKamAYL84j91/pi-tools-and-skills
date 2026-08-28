/**
 * Unit tests for the failure-threshold breaker (T-871, ADR rollback clause):
 * unclean starts accumulate, the threshold disables fail-closed, graceful
 * stops reset the ladder, state corruption disables immediately, and the
 * flag clears explicitly.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearDaemonDisabled,
	CRASH_THRESHOLD,
	isDaemonDisabled,
	markGracefulStop,
	gracefulStopSeenSinceLastStart,
	recordDaemonStart,
	recordStateCorruption,
} from "../../daemon/src/breaker.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-breaker-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

describe("failure-threshold breaker (ADR rollback clause)", () => {
	it("accumulates unclean starts and disables at the threshold", async () => {
		const roots = await makeRoots();
		try {
			for (let i = 0; i < CRASH_THRESHOLD - 1; i++) {
				const result = await recordDaemonStart(roots, false, new Date(2026, 0, 1, i, 0));
				expect(result.disabled).toBe(false);
			}
			const crossing = await recordDaemonStart(roots, false, new Date(2026, 0, 1, 3, 0));
			expect(crossing.disabled).toBe(true);
			expect(await isDaemonDisabled(roots)).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("a graceful stop resets the crash ladder", async () => {
		const roots = await makeRoots();
		try {
			await recordDaemonStart(roots, false, new Date(2026, 0, 1, 0, 0));
			await recordDaemonStart(roots, false, new Date(2026, 0, 1, 1, 0));
			await markGracefulStop(roots);
			expect(await gracefulStopSeenSinceLastStart(roots)).toBe(true);
			const result = await recordDaemonStart(roots, true, new Date(2026, 0, 1, 2, 0));
			expect(result.crashesInWindow).toBe(0);
			expect(result.disabled).toBe(false);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("state corruption disables immediately", async () => {
		const roots = await makeRoots();
		try {
			await recordStateCorruption(roots, "corrupt tail in schedule-state", new Date(2026, 0, 1, 0, 0));
			expect(await isDaemonDisabled(roots)).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("the disabled flag clears explicitly with an audit trail", async () => {
		const roots = await makeRoots();
		try {
			await recordStateCorruption(roots, "test", new Date());
			expect(await clearDaemonDisabled(roots, "principal")).toBe(true);
			expect(await isDaemonDisabled(roots)).toBe(false);
			expect(await clearDaemonDisabled(roots, "a-second-time")).toBe(false);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});
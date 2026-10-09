/**
 * Regression coverage for matrix-js-sdk module-global logging.
 *
 * The SDK's module-level code (scheduler, embedded, sliding-sync) logs through
 * the package-global `logger`, which the per-client `logger` option does not
 * replace. That housekeeping used to reach the console and leak into pi's TUI
 * as unsolicited turns.
 */
import { describe, expect, it, vi } from "vitest";
import { logger } from "matrix-js-sdk/lib/logger.js";
import { silenceSdkGlobalLogger } from "../../extensions/pi-matrix/js-sdk-adapter.js";

describe("silenceSdkGlobalLogger", () => {
	it("keeps queue/pending-event housekeeping out of the console", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		await silenceSdkGlobalLogger(vi.fn());

		logger.info("Stopping queue '%s' as it is now empty", "message");
		logger.log("setting pendingEvent status to sent in event ID ~abc -> $txn");

		expect(info).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
		info.mockRestore();
		log.mockRestore();
	});

	it("routes warn and error to the notify path", async () => {
		const onLog = vi.fn();
		await silenceSdkGlobalLogger(onLog);

		logger.warn("careful");
		logger.error(new Error("boom"));

		expect(onLog).toHaveBeenCalledWith("careful", "warning");
		expect(onLog).toHaveBeenCalledWith("boom", "error");
	});
});

/** Throwaway end-to-end check against the real matrix-js-sdk (no mocks). */
import { describe, expect, it } from "vitest";

import loglevel from "loglevel";
import { silenceSdkGlobalLogger } from "../js-sdk-adapter.js";

describe("real sdk logging e2e", () => {
	it("silences MatrixRTC child-logger debug and push-rule warns", async () => {
		const onLog: Array<[string, string]> = [];
		await silenceSdkGlobalLogger((message, level) => {
			onLog.push([message, level]);
		});

		// What matrix-js-sdk/runtime does for MatrixRTC sessions in rooms with
		// call traffic: a console-bound loglevel child logger under "matrix-…".
		const rtc = loglevel.getLogger(
			"matrix-[MatrixRTCSession !9lC2CDN-juq6wsKC_ef7NVxfp3rss9e76GlfEgqMotc m.call#ROOM]",
		);
		rtc.debug("No membership changes detected for room !9lC2CDN-juq6wsKC_ef7NVxfp3rss9e76GlfEgqMotc");
		rtc.info("Leaving call session");

		// PushProcessor reconciliation lines (warn via client logger path):
		const { logger } = await import("matrix-js-sdk/lib/logger.js");
		logger.warn("Missing default global override push rule .m.rule.contains_display_name");
		logger.warn("Adding default global underride push rule .org.matrix.msc3914.rule.room.call");

		// A real warning must still reach the notify path.
		rtc.error("MembershipManager unrecoverable");
		expect(onLog).toEqual([["MembershipManager unrecoverable", "error"]]);
	});
});
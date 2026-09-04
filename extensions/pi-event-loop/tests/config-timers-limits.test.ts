/** Timer and limits validation tests for pi-event-loop configuration (SPEC §6, §12, §18). */

import { describe, expect, it } from "vitest";

import { parseEventLoopConfig } from "../config.js";
import { configText } from "../../../tests/fixtures/pi-event-loop.js";

describe("pi-event-loop timers and limits", () => {
	it("rejects timers that reference undefined events or combine interval and dailyAt", () => {
		const raw = JSON.parse(configText()) as {
			profiles: Record<string, Record<string, unknown>>;
		};
		const profile = raw["profiles"]["default"] as Record<string, unknown>;
		profile["timers"] = [
			{
				id: "t1",
				intervalMinutes: 5,
				dailyAt: "09:00",
				emit: "work.requested",
			},
			{ id: "t2", dailyAt: "99:99", emit: "work.requested" },
			{ id: "t3", intervalMinutes: 0, emit: "work.requested" },
			{ id: "t4", emit: "work.requested" },
		];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		const joined = result.errors.join(" ");
		expect(joined).toContain(
			'timers require either "intervalMinutes" or "dailyAt"',
		);
		expect(joined).toContain(
			'"intervalMinutes" and "dailyAt" are mutually exclusive',
		);
		expect(joined).toContain('"dailyAt" must be "HH:MM"');
		expect(joined).toContain('"intervalMinutes" must be a positive integer');
	});

	it("rejects timers referencing undefined events", () => {
		const raw = JSON.parse(configText()) as {
			profiles: Record<string, Record<string, unknown>>;
		};
		const profile = raw["profiles"]["default"] as Record<string, unknown>;
		profile["timers"] = [{ id: "t1", intervalMinutes: 5, emit: "nope.event" }];
		const result = parseEventLoopConfig(JSON.stringify(raw));
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain(
			'emit event "nope.event" is not defined',
		);
	});

	it("rejects limits outside the hard-coded ceilings", () => {
		const result = parseEventLoopConfig(
			configText({ limits: { maxChainDepth: 65 } }),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("exceeds the ceiling of 64");
	});

	it("rejects non-integer limits", () => {
		const result = parseEventLoopConfig(
			configText({ limits: { maxPendingCommands: 1.5 } }),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("must be a positive integer");
	});
});

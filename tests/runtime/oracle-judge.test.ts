import { describe, expect, it } from "vitest";
import { evaluateOracleJudges } from "../helpers/oracle-judge.js";

const FIXTURE = {
	id: "synthetic-change-1",
	judges: [
		{ criterion: "correctness", score: 0.9, weight: 3, reason: "tests cover the intended behavior" },
		{ criterion: "safety", score: 0.8, weight: 2, reason: "no external side effects" },
		{ criterion: "simplicity", score: 0.7, weight: 1, reason: "one small helper" },
	],
};

describe("evaluateOracleJudges", () => {
	it("combines weighted judge scores into a deterministic result", () => {
		const first = evaluateOracleJudges(FIXTURE);
		const second = evaluateOracleJudges(FIXTURE);

		expect(first).toEqual(second);
		expect(first).toMatchObject({ id: "synthetic-change-1", verdict: "pass", maxScore: 6 });
		expect(first.normalized).toBeCloseTo((0.9 * 3 + 0.8 * 2 + 0.7) / 6);
		expect(first.reasons).toEqual([
			"correctness: tests cover the intended behavior",
			"safety: no external side effects",
			"simplicity: one small helper",
		]);
	});

	it("returns warn and fail using thresholds", () => {
		expect(evaluateOracleJudges({ id: "warn", judges: [{ criterion: "quality", score: 0.7, reason: "partial" }] }).verdict).toBe("warn");
		expect(evaluateOracleJudges({ id: "fail", judges: [{ criterion: "quality", score: 0.4, reason: "insufficient" }] }).verdict).toBe("fail");
	});

	it("rejects invalid fixture shapes", () => {
		expect(() => evaluateOracleJudges({ id: "", judges: FIXTURE.judges })).toThrow(/id/);
		expect(() => evaluateOracleJudges({ id: "empty", judges: [] })).toThrow(/at least one/);
		expect(() => evaluateOracleJudges({ id: "bad-score", judges: [{ criterion: "x", score: 2, reason: "bad" }] })).toThrow(/between 0 and 1/);
		expect(() => evaluateOracleJudges({ id: "bad-weight", judges: [{ criterion: "x", score: 1, weight: 0, reason: "bad" }] })).toThrow(/positive/);
		expect(() => evaluateOracleJudges({ id: "bad-threshold", judges: [{ criterion: "x", score: 1, reason: "ok" }], passThreshold: 0.5, warnThreshold: 0.7 })).toThrow(/thresholds/);
	});
});

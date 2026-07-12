import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	resolveTeamProfile,
	type TeamProfile,
} from "../../extensions/pi-panopticon/teams/team-profiles.js";
import { directTeamResultBody } from "../../extensions/pi-panopticon/teams/team-result.js";
import { isTopology } from "../../extensions/pi-panopticon/teams/team-routes.js";

const FUSION_ARRAY_FIELDS = [
	"consensus",
	"contradictions",
	"partialCoverage",
	"uniqueInsights",
	"blindSpots",
	"missingEvidence",
] as const;
const RUBRIC_FIELDS = ["routing", "bounds", "validity", "behavior"] as const;

interface ExpectedContract {
	panelModels?: number;
	panelMaxTokens?: number;
	judgeMaxTokens?: number;
	panelMaxChars?: number;
	promptMaxChars?: number;
	navigatorMaxTokens?: number;
	navigatorTimeoutMs?: number;
	navigatorMaxRetries?: number;
	historyTurns: number;
	historyChars: number;
	valid: boolean;
	directBody: string;
}

interface SpeedProfileCase {
	id: string;
	team: "fusion-analysis" | "navigator";
	profile?: TeamProfile;
	selectedRoute: string;
	expected: ExpectedContract;
	result: string;
}

interface SpeedProfileFixture {
	schemaVersion: number;
	rubric: Record<string, string>;
	cases: SpeedProfileCase[];
}

function readFixture(): SpeedProfileFixture {
	const parsed: unknown = JSON.parse(
		readFileSync("tests/evals/fixtures/team-speed-profiles.json", "utf8"),
	);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("cases" in parsed) ||
		!("rubric" in parsed)
	) {
		throw new Error("invalid team speed profile fixture");
	}
	// The fixture shape is exercised field-by-field below; this assertion only bridges JSON.parse.
	return parsed as SpeedProfileFixture;
}

function isValidResult(testCase: SpeedProfileCase): boolean {
	if (testCase.team === "navigator") return testCase.result.trim().length > 0;
	try {
		const parsed: unknown = JSON.parse(testCase.result);
		if (typeof parsed !== "object" || parsed === null) return false;
		const result = parsed as Record<string, unknown>;
		return (
			typeof result.answer === "string" &&
			result.answer.trim().length > 0 &&
			typeof result.confidence === "string" &&
			FUSION_ARRAY_FIELDS.every((field) => Array.isArray(result[field]))
		);
	} catch {
		return false;
	}
}

const fixture = readFixture();

describe("team speed profile deterministic evaluation", () => {
	it("defines the complete bounded rubric", () => {
		expect(fixture.schemaVersion).toBe(1);
		expect(Object.keys(fixture.rubric).sort()).toEqual(
			[...RUBRIC_FIELDS].sort(),
		);
		for (const field of RUBRIC_FIELDS)
			expect(fixture.rubric[field]?.trim().length).toBeGreaterThan(0);
	});

	for (const testCase of fixture.cases) {
		it(`${testCase.id} satisfies routing, bounds, validity, and result behavior`, () => {
			const profile = resolveTeamProfile(testCase.profile);
			expect(isTopology(testCase.selectedRoute)).toBe(true);
			expect(testCase.selectedRoute).toBe(testCase.team);
			expect(profile).toMatchObject({
				...(testCase.expected.panelModels === undefined
					? {}
					: { fusionPanelModels: testCase.expected.panelModels }),
				...(testCase.expected.panelMaxTokens === undefined
					? {}
					: { fusionPanelMaxTokens: testCase.expected.panelMaxTokens }),
				...(testCase.expected.judgeMaxTokens === undefined
					? {}
					: { fusionJudgeMaxTokens: testCase.expected.judgeMaxTokens }),
				...(testCase.expected.panelMaxChars === undefined
					? {}
					: { fusionPanelMaxChars: testCase.expected.panelMaxChars }),
				...(testCase.expected.promptMaxChars === undefined
					? {}
					: { fusionPromptMaxChars: testCase.expected.promptMaxChars }),
				...(testCase.expected.navigatorMaxTokens === undefined
					? {}
					: { navigatorMaxTokens: testCase.expected.navigatorMaxTokens }),
				...(testCase.expected.navigatorTimeoutMs === undefined
					? {}
					: { navigatorTimeoutMs: testCase.expected.navigatorTimeoutMs }),
				...(testCase.expected.navigatorMaxRetries === undefined
					? {}
					: { navigatorMaxRetries: testCase.expected.navigatorMaxRetries }),
				historyTurns: testCase.expected.historyTurns,
				historyChars: testCase.expected.historyChars,
			});
			expect(isValidResult(testCase)).toBe(testCase.expected.valid);
			expect(directTeamResultBody(testCase.team, testCase.result)).toBe(
				testCase.expected.directBody,
			);
		});
	}
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	resolveTeamProfile,
	type TeamProfile,
} from "../../extensions/pi-teams/team-profiles.js";
import { directTeamResultBody } from "../../extensions/pi-teams/team-result.js";
import { loadTeamRegistry } from "../../extensions/pi-teams/team-registry.js";

const RUBRIC_FIELDS = ["routing", "bounds", "validity", "behavior"] as const;

interface ExpectedContract {
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
	team: "navigator";
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
	return testCase.result.trim().length > 0;
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
			expect(loadTeamRegistry(undefined, { roots: [] }).teams.has(testCase.selectedRoute)).toBe(true);
			expect(testCase.selectedRoute).toBe(testCase.team);
			expect(profile).toMatchObject({
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

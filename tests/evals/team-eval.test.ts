import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isTopology } from "../../extensions/pi-panopticon/teams/team-routes.js";

describe("Team Protocol Routing Evaluation", () => {
    const fixturesPath = "tests/evals/fixtures/routing-fixtures.json";
    const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8"));

    Object.keys(fixtures).forEach(route => {
        it(`should route ${route} appropriately`, () => {
            const expected = fixtures[route].expected;
            // Test actual routing logic using system topology
            expect(isTopology(route)).toBe(expected);
        });
    });
});

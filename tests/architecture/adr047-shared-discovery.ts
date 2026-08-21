/** ADR-047 dependency and neutral-shared-library fitness checks. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const discovery = readFileSync("lib/declarative-discovery.ts", "utf8");
const teamPaths = readFileSync("extensions/pi-panopticon/teams/team-paths.ts", "utf8");
const boostResolver = readFileSync("extensions/pi-boost/boost-descriptor-adapter.ts", "utf8");
const boostSources = [
	"extensions/pi-boost/boost-descriptor-adapter.ts",
	"extensions/pi-boost/live-boost-control-contract.ts",
	"extensions/pi-boost/live-boost-control-adapter.ts",
	"extensions/pi-boost/host-injected-live-boost.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");

describe("ADR-047 shared declarative discovery", () => {
	it("keeps shared discovery extension-neutral and imported by both consumers", () => {
		expect(discovery).not.toMatch(/pi-panopticon|pi-boost|teamId|enablementId|provider|model/i);
		expect(teamPaths).toContain("lib/declarative-discovery.js");
		expect(boostResolver).toContain("lib/declarative-discovery.js");
	});

	it("keeps extensions independent and removes Team-shaped Boost identity", () => {
		expect(teamPaths).not.toContain("pi-boost");
		expect(boostSources).not.toMatch(/teamId|EXTERNAL_BOOST_TEAM_ID|protocol:\s*["']boost/);
		expect(boostSources).not.toContain("config.json");
	});
});

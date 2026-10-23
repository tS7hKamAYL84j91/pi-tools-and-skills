/**
 * Logical mention parsing for the shared EO Leads room.
 *
 * All leads share one Matrix account, so a Matrix pill cannot identify a lead;
 * the mention has to be a body token matched by each client against its own
 * launcher-declared names.
 */

import { describe, expect, it } from "vitest";

import { extractMentions, mentionsAgent } from "../mention.js";

describe("extractMentions", () => {
	it("extracts plain and punctuated mentions, lower-cased", () => {
		expect(extractMentions("@gemma please check")).toEqual(["gemma"]);
		expect(extractMentions("hi @Gemma, status?")).toEqual(["gemma"]);
		expect(extractMentions("@gemma.")).toEqual(["gemma"]);
		expect(extractMentions("@lead-a @lead-b both")).toEqual(["lead-a", "lead-b"]);
		expect(extractMentions("@kaggle-gemma-4-developer-agent-gm: ping")).toEqual([
			"kaggle-gemma-4-developer-agent-gm",
		]);
	});

	it("ignores non-mentions: emails, handles inside words, bare @", () => {
		expect(extractMentions("mail me at jim@example.com")).toEqual([]);
		expect(extractMentions("user@lead-a")).toEqual([]);
		expect(extractMentions("@ alone")).toEqual([]);
		expect(extractMentions("no mentions here")).toEqual([]);
	});

	it("does not treat a suffix as a mention of the shorter name", () => {
		expect(extractMentions("@gemma-4 look")).toEqual(["gemma-4"]);
		expect(mentionsAgent("@gemma-4 look", ["gemma"])).toBe(false);
	});
});

describe("mentionsAgent", () => {
	const names = ["quartermaster", "lead-a"];

	it("matches declared names case-insensitively", () => {
		expect(mentionsAgent("hey @QuarterMaster", names)).toBe(true);
		expect(mentionsAgent("hey @lead-a", names)).toBe(true);
		expect(mentionsAgent("hey @lead-b", names)).toBe(false);
	});

	it("matches every target in a multi-mention message", () => {
		const body = "@lead-a and @quartermaster please";
		expect(mentionsAgent(body, ["lead-a"])).toBe(true);
		expect(mentionsAgent(body, ["quartermaster"])).toBe(true);
		expect(mentionsAgent(body, ["lead-b"])).toBe(false);
	});

	it("treats @all as everyone by default and can be disabled", () => {
		expect(mentionsAgent("@all standup", names)).toBe(true);
		expect(mentionsAgent("@all standup", names, { all: false })).toBe(false);
		expect(mentionsAgent("@allx nope", names)).toBe(false);
	});

	it("requires a mention when no names are declared (fail closed)", () => {
		expect(mentionsAgent("hello", [])).toBe(false);
		expect(mentionsAgent("@all hello", [])).toBe(true);
		expect(mentionsAgent("@all hello", [], { all: false })).toBe(false);
	});
});

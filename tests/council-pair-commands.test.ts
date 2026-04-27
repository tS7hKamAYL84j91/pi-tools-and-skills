import { describe, expect, it } from "vitest";

import {
	type PairDefinition,
	pickPair,
} from "../extensions/pi-llm-council/pair-commands.js";

function makeDef(name: string, navigator: string): PairDefinition {
	return { name, navigator, createdAt: 0 };
}

function pairsOf(...defs: PairDefinition[]): Map<string, PairDefinition> {
	const m = new Map<string, PairDefinition>();
	for (const d of defs) m.set(d.name, d);
	return m;
}

describe("pickPair", () => {
	it("returns a clear error when no pairs are configured", () => {
		const result = pickPair(new Map());
		expect(result).toEqual({
			error: "No pair configured. Run /pair-form to set up a Navigator.",
		});
	});

	it("returns the only pair when exactly one exists and no name is requested", () => {
		const only = makeDef("review", "anthropic/claude-opus");
		const result = pickPair(pairsOf(only));
		expect(result).toEqual(only);
	});

	it("returns an ambiguity error when multiple pairs exist and no name is given", () => {
		const result = pickPair(
			pairsOf(makeDef("a", "openai/gpt-5"), makeDef("b", "anthropic/claude")),
		);
		expect(result).toMatchObject({
			error: expect.stringMatching(/Multiple pairs available.*a.*b/),
		});
	});

	it("returns the named pair when requested by name", () => {
		const wanted = makeDef("review", "anthropic/claude");
		const result = pickPair(
			pairsOf(makeDef("other", "openai/gpt-5"), wanted),
			"review",
		);
		expect(result).toEqual(wanted);
	});

	it("returns a not-found error when the requested name is missing", () => {
		const result = pickPair(
			pairsOf(makeDef("review", "anthropic/claude")),
			"nope",
		);
		expect(result).toEqual({
			error: 'No pair "nope". Run /pair-form to set one up.',
		});
	});

	it("requested-name match wins over the single-pair shortcut", () => {
		// With one pair named "review" but requested name "other", expect
		// not-found error (not the single-pair fallback).
		const result = pickPair(
			pairsOf(makeDef("review", "anthropic/claude")),
			"other",
		);
		expect(result).toMatchObject({ error: expect.stringContaining("other") });
	});
});

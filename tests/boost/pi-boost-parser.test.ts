import { describe, expect, it } from "vitest";

import {
	BOOST_REVIEW_FRAME,
	combineBoostInput,
	MAX_BOOST_INPUT_BYTES,
	parseBoostCommand,
} from "../../extensions/pi-boost/boost/parser.js";

function expectRequest(input: string) {
	const result = parseBoostCommand(input);
	expect(result.ok).toBe(true);
	if (!result.ok || result.command.kind !== "request") {
		throw new Error("Expected a boost request");
	}
	return result.command.request;
}

describe("ADR-045 boost parser", () => {
	it("parses terminal status and reset subcommands", () => {
		expect(parseBoostCommand("/boost status")).toEqual({
			ok: true,
			command: { kind: "status" },
		});
		expect(parseBoostCommand("/boost reset")).toEqual({
			ok: true,
			command: { kind: "reset" },
		});
	});

	it.each([
		"/boost status extra",
		"/boost reset now",
	])("rejects trailing terminal-subcommand tokens in %s", (input) => {
		expect(parseBoostCommand(input)).toMatchObject({
			ok: false,
			error: { code: "trailing-subcommand" },
		});
	});

	it("requires -- when a request prompt begins with a terminal word", () => {
		expect(parseBoostCommand("/boost status should be reviewed")).toMatchObject(
			{
				ok: false,
				error: { code: "trailing-subcommand" },
			},
		);
		expect(expectRequest("/boost -- status should be reviewed").prompt).toBe(
			"status should be reviewed",
		);
		expect(expectRequest("/boost -- reset this design").prompt).toBe(
			"reset this design",
		);
	});

	it("parses bounded options before the explicit prompt", () => {
		expect(expectRequest("/boost -n 3 --clean inspect the diff")).toMatchObject(
			{
				requestedYields: 3,
				isolation: "clean",
				prompt: "inspect the diff",
			},
		);
		expect(expectRequest("/boost --fresh -n 2 -- inspect")).toMatchObject({
			requestedYields: 2,
			isolation: "fresh",
			prompt: "inspect",
		});
	});

	it.each([
		["/boost -n 0 inspect", "invalid-yield-count"],
		["/boost -n 4 inspect", "invalid-yield-count"],
		["/boost -n nope inspect", "invalid-yield-count"],
		["/boost -n 1 -n 2 inspect", "repeated-option"],
		["/boost --clean --clean inspect", "repeated-option"],
		["/boost --clean --fresh inspect", "conflicting-isolation"],
		["/boost --unknown inspect", "unknown-option"],
	] as const)("rejects invalid option input %s", (input, code) => {
		expect(parseBoostCommand(input)).toMatchObject({
			ok: false,
			error: { code },
		});
	});

	it.each(["/boost", "/boost   "])("opens settings when no arguments are supplied in %s", (input) => {
		expect(parseBoostCommand(input)).toEqual({ ok: true, command: { kind: "settings" } });
	});

	it.each([
		"/boost -n 1",
		"/boost --",
	])("rejects an absent prompt in %s", (input) => {
		expect(parseBoostCommand(input)).toMatchObject({
			ok: false,
			error: { code: "missing-prompt" },
		});
	});

	it("caps framing and explicit prompt together at 2,048 UTF-8 bytes", () => {
		const framingBytes = Buffer.byteLength(`${BOOST_REVIEW_FRAME}\n`, "utf8");
		const exactPrompt = "a".repeat(MAX_BOOST_INPUT_BYTES - framingBytes);
		const overPrompt = `${exactPrompt}b`;

		expect(
			Buffer.byteLength(
				expectRequest(`/boost -- ${exactPrompt}`).combinedInput,
				"utf8",
			),
		).toBe(MAX_BOOST_INPUT_BYTES);
		expect(parseBoostCommand(`/boost -- ${overPrompt}`)).toMatchObject({
			ok: false,
			error: { code: "input-too-large" },
		});
	});

	it("measures multibyte prompts in UTF-8 bytes", () => {
		const available =
			MAX_BOOST_INPUT_BYTES -
			Buffer.byteLength(`${BOOST_REVIEW_FRAME}\n`, "utf8");
		const fitting = "é".repeat(Math.floor(available / 2));
		const tooLarge = `${fitting}é`;

		expect(parseBoostCommand(`/boost -- ${fitting}`).ok).toBe(true);
		expect(parseBoostCommand(`/boost -- ${tooLarge}`)).toMatchObject({
			ok: false,
			error: { code: "input-too-large" },
		});
	});

	it("constructs only the fixed ephemeral frame and explicit prompt", () => {
		expect(combineBoostInput("inspect")).toBe(`${BOOST_REVIEW_FRAME}\ninspect`);
	});
});

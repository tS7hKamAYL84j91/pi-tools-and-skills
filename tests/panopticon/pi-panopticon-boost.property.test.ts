import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
	BoostIsolationMode,
	BoostTerminalOutcome,
} from "../../extensions/pi-panopticon/boost/contracts.js";
import {
	BOOST_REVIEW_FRAME,
	combineBoostInput,
	MAX_BOOST_INPUT_BYTES,
	parseBoostCommand,
} from "../../extensions/pi-panopticon/boost/parser.js";
import { assertProperty } from "../lib/fast-check.js";
import {
	activate,
	BASELINE_MODEL,
	createBoostHarness,
	PRINCIPAL,
	request,
	reserve,
} from "./boost-helpers.js";

const promptArbitrary = fc
	.array(fc.constantFrom("a", "Z", "0", "é", "🙂", " ", "-", "status"), {
		minLength: 1,
		maxLength: 40,
	})
	.map((parts) => `p${parts.join("")}q`);

const isolationArbitrary = fc.constantFrom<BoostIsolationMode>(
	"current",
	"clean",
	"fresh",
);

const outcomeArbitrary = fc.constantFrom<BoostTerminalOutcome>(
	"visible",
	"collapsed-visible",
	"cancelled",
	"failed",
	"tool-only",
	"suppressed",
);

function isolationOption(isolation: BoostIsolationMode): string | undefined {
	if (isolation === "current") {
		return undefined;
	}
	return `--${isolation}`;
}

function expectRequest(input: string) {
	const result = parseBoostCommand(input);
	if (!result.ok || result.command.kind !== "request") {
		throw new Error(`Expected request, received ${JSON.stringify(result)}`);
	}
	return result.command.request;
}

describe("bounded boost properties", () => {
	it("preserves generated bounded options and explicit prompts", () => {
		assertProperty(
			fc.property(
				fc.integer({ min: 1, max: 3 }),
				isolationArbitrary,
				fc.boolean(),
				promptArbitrary,
				(requestedYields, isolation, reverseOptions, prompt) => {
					const options = [`-n ${requestedYields}`, isolationOption(isolation)].filter(
						(option): option is string => option !== undefined,
					);
					if (reverseOptions) {
						options.reverse();
					}
					const parsed = expectRequest(`/boost ${options.join(" ")} -- ${prompt}`);

					expect(parsed).toEqual({
						requestedYields,
						isolation,
						prompt,
						combinedInput: combineBoostInput(prompt),
					});
				},
			),
		);
	});

	it("requires an explicit prompt boundary for generated terminal-prefixed prompts", () => {
		assertProperty(
			fc.property(
				fc.constantFrom("status", "reset"),
				promptArbitrary,
				(terminal, promptTail) => {
					const prompt = `${terminal} ${promptTail}`;

					expect(parseBoostCommand(`/boost ${prompt}`)).toMatchObject({
						ok: false,
						error: { code: "trailing-subcommand" },
					});
					expect(expectRequest(`/boost -- ${prompt}`).prompt).toBe(prompt);
				},
			),
		);
	});

	it("enforces the combined UTF-8 byte cap around generated boundaries", () => {
		const availablePromptBytes =
			MAX_BOOST_INPUT_BYTES -
			Buffer.byteLength(`${BOOST_REVIEW_FRAME}\n`, "utf8");
		assertProperty(
			fc.property(
				fc.constantFrom("a", "é", "🙂"),
				fc.integer({ min: -2, max: 2 }),
				(character, offset) => {
					const characterBytes = Buffer.byteLength(character, "utf8");
					const repeatCount = Math.floor(availablePromptBytes / characterBytes) + offset;
					const prompt = character.repeat(repeatCount);
					const combinedInput = combineBoostInput(prompt);
					const fits = Buffer.byteLength(combinedInput, "utf8") <= MAX_BOOST_INPUT_BYTES;
					const result = parseBoostCommand(`/boost -- ${prompt}`);

					if (fits) {
						expect(expectRequest(`/boost -- ${prompt}`).combinedInput).toBe(
							combinedInput,
						);
					} else {
						expect(result).toMatchObject({
							ok: false,
							error: { code: "input-too-large" },
						});
					}
				},
			),
		);
	});

	it("reverts once and accounts for at most one generated terminal yield", () => {
		assertProperty(
			fc.property(
				fc.integer({ min: 2, max: 3 }),
				outcomeArbitrary,
				(requestedYields, outcome) => {
					const harness = createBoostHarness();
					const leaseId = reserve(harness, request({ requestedYields }));
					expect(activate(harness, leaseId).ok).toBe(true);

					const isHumanYield = outcome === "visible" || outcome === "collapsed-visible";
					const consumedYields = isHumanYield ? 1 : 0;
					expect(
						harness.authority.settle({ leaseId, activationId: 1, outcome }),
					).toMatchObject({
						ok: true,
						value: {
							state: "Reserved",
							consumedYields,
							remainingYields: requestedYields - consumedYields,
						},
					});
					expect(harness.restoredModels).toEqual([BASELINE_MODEL]);

					expect(
						harness.authority.settle({ leaseId, activationId: 1, outcome }),
					).toMatchObject({ ok: false });
					expect(harness.restoredModels).toEqual([BASELINE_MODEL]);
					expect(harness.authority.getStatus(PRINCIPAL)).toMatchObject({
						ok: true,
						value: { consumedYields },
					});
				},
			),
		);
	});
});

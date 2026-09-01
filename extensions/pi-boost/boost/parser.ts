/** Pure ADR-045 and ADR-050 `/boost` grammar and combined-input boundary. */

import { parseFusionRequest } from "./cognitive-parser.js";
import type { BoostParseErrorCode, BoostParseResult } from "./boost-parse-types.js";
import type { BoostIsolationMode } from "./contracts.js";


export const BOOST_REVIEW_FRAME = `[BOOST REVIEW FRAME — EPHEMERAL]
Challenge assumptions. Inspect the underlying diff when available. Avoid repeating recent failed edits.
[/BOOST REVIEW FRAME]`;
export const MAX_BOOST_INPUT_BYTES = 2_048;

interface Token {
	readonly value: string;
	readonly start: number;
	readonly end: number;
}

interface ParsedOptions {
	isolation: BoostIsolationMode;
	isolationSeen: boolean;
	yieldCount: number;
	yieldCountSeen: boolean;
}

export function combineBoostInput(prompt: string): string {
	return `${BOOST_REVIEW_FRAME}\n${prompt}`;
}

export function parseBoostCommand(input: string): BoostParseResult {
	if (
		!input.startsWith("/boost") ||
		(input.length > 6 && !isWhitespace(input[6]))
	) {
		return parseError(
			"not-boost-command",
			"Expected /boost followed by whitespace",
		);
	}
	const body = input.slice(6).trim();
	if (body.length === 0) {
		return { ok: true, command: { kind: "settings" } };
	}
	const tokens = tokenize(body);
	const first = tokens[0];
	if (!first) {
		return parseError("missing-prompt", "Boost requires a prompt");
	}
	if (
		first.value === "status" ||
		first.value === "reset" ||
		first.value === "settings" ||
		first.value === "config"
	) {
		if (tokens.length !== 1) {
			return parseError(
				"trailing-subcommand",
				`${first.value} does not accept trailing tokens`,
			);
		}
		return {
			ok: true,
			command: {
				kind:
					first.value === "settings" || first.value === "config"
						? "settings"
						: first.value,
			},
		};
	}
	if (first.value === "fusion") {
		return parseFusionRequest(body, tokens);
	}
	return parseRequest(body, tokens);
}

function parseRequest(
	body: string,
	tokens: readonly Token[],
): BoostParseResult {
	const options: ParsedOptions = {
		isolation: "current",
		isolationSeen: false,
		yieldCount: 1,
		yieldCountSeen: false,
	};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			break;
		}
		if (token.value === "--") {
			return requestFromPrompt(body.slice(token.end).trimStart(), options);
		}
		if (token.value === "-n") {
			if (options.yieldCountSeen) {
				return parseError("repeated-option", "-n may be specified only once");
			}
			const countToken = tokens[index + 1];
			if (!countToken || !/^[1-3]$/.test(countToken.value)) {
				return parseError("invalid-yield-count", "-n must be 1, 2, or 3");
			}
			options.yieldCount = Number(countToken.value);
			options.yieldCountSeen = true;
			index += 1;
			continue;
		}
		if (token.value === "--clean" || token.value === "--fresh") {
			const mode = token.value === "--clean" ? "clean" : "fresh";
			if (options.isolationSeen) {
				const code =
					options.isolation === mode
						? "repeated-option"
						: "conflicting-isolation";
				return parseError(code, "Isolation options may be specified only once");
			}
			options.isolation = mode;
			options.isolationSeen = true;
			continue;
		}
		if (token.value.startsWith("-")) {
			return parseError("unknown-option", "Unknown boost option");
		}
		if (
			token.value === "status" ||
			token.value === "reset" ||
			token.value === "settings" ||
			token.value === "config"
		) {
			return parseError(
				"trailing-subcommand",
				`Prompt beginning with ${token.value} requires --`,
			);
		}
		return requestFromPrompt(body.slice(token.start).trimEnd(), options);
	}
	return parseError("missing-prompt", "Boost requires an explicit prompt");
}

function requestFromPrompt(
	prompt: string,
	options: ParsedOptions,
): BoostParseResult {
	if (prompt.length === 0) {
		return parseError("missing-prompt", "Boost requires an explicit prompt");
	}
	const combinedInput = combineBoostInput(prompt);
	if (utf8ByteLength(combinedInput) > MAX_BOOST_INPUT_BYTES) {
		return parseError(
			"input-too-large",
			"Boost frame and prompt exceed 2,048 UTF-8 bytes",
		);
	}
	return {
		ok: true,
		command: {
			kind: "request",
			request: {
				requestedYields: options.yieldCount,
				isolation: options.isolation,
				prompt,
				combinedInput,
			},
		},
	};
}

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	for (const match of input.matchAll(/\S+/g)) {
		const value = match[0];
		const start = match.index;
		tokens.push({ value, start, end: start + value.length });
	}
	return tokens;
}

function utf8ByteLength(input: string): number {
	return new TextEncoder().encode(input).byteLength;
}

function isWhitespace(value: string | undefined): boolean {
	return value !== undefined && /\s/.test(value);
}

function parseError(
	code: BoostParseErrorCode,
	message: string,
): BoostParseResult {
	return { ok: false, error: { code, message } };
}

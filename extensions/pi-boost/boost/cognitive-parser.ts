/** Pure parser for the `/boost fusion` subcommand. */

import type { BoostFusionRequest, CognitiveProfile } from "./cognitive-types.js";
import type {
	BoostParseErrorCode,
	BoostParseResult,
} from "./boost-parse-types.js";

export const MAX_BOOST_FUSION_PROMPT_BYTES = 50_000;

interface FusionToken {
	readonly value: string;
	readonly start: number;
	readonly end: number;
}

interface ParsedFusionOptions {
	profile?: CognitiveProfile;
	profileSeen: boolean;
	panelSize?: number;
	panelSizeSeen: boolean;
}

/** Parse the fusion subcommand after `/boost` has been removed. */
export function parseFusionRequest(
	body: string,
	tokens: readonly FusionToken[],
): BoostParseResult {
	if (tokens.length === 1) {
		return parseError("missing-prompt", "Boost fusion requires a prompt");
	}
	const options: ParsedFusionOptions = {
		profileSeen: false,
		panelSizeSeen: false,
	};
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			break;
		}
		if (token.value === "--") {
			return fusionRequestFromPrompt(body.slice(token.end).trimStart(), options);
		}
		if (token.value === "--profile") {
			if (options.profileSeen) {
				return parseError(
					"repeated-option",
					"--profile may be specified only once",
				);
			}
			const profileToken = tokens[index + 1];
			if (
				!profileToken ||
				!/^(fast|balanced|thorough)$/.test(profileToken.value)
			) {
				return parseError(
					"invalid-profile",
					"--profile must be fast, balanced, or thorough",
				);
			}
			options.profile = profileToken.value as CognitiveProfile;
			options.profileSeen = true;
			index += 1;
			continue;
		}
		if (token.value === "-n" || token.value === "--panel-size") {
			if (options.panelSizeSeen) {
				return parseError(
					"repeated-option",
					"Panel size may be specified only once",
				);
			}
			const countToken = tokens[index + 1];
			if (!countToken || !/^[1-4]$/.test(countToken.value)) {
				return parseError(
					"invalid-panel-size",
					"-n/--panel-size must be 1, 2, 3, or 4",
				);
			}
			options.panelSize = Number(countToken.value);
			options.panelSizeSeen = true;
			index += 1;
			continue;
		}
		if (token.value.startsWith("-")) {
			return parseError("unknown-option", "Unknown boost option");
		}
		return fusionRequestFromPrompt(body.slice(token.start).trimEnd(), options);
	}
	return parseError(
		"missing-prompt",
		"Boost fusion requires an explicit prompt",
	);
}

function fusionRequestFromPrompt(
	prompt: string,
	options: ParsedFusionOptions,
): BoostParseResult {
	if (prompt.length === 0) {
		return parseError(
			"missing-prompt",
			"Boost fusion requires an explicit prompt",
		);
	}
	if (new TextEncoder().encode(prompt).byteLength > MAX_BOOST_FUSION_PROMPT_BYTES) {
		return parseError(
			"input-too-large",
			"Boost fusion prompt exceeds byte limit",
		);
	}
	const fusion: BoostFusionRequest = {
		prompt,
		...(options.profile ? { profile: options.profile } : {}),
		...(options.panelSize !== undefined
			? { panelSize: options.panelSize }
			: {}),
	};
	return { ok: true, command: { kind: "fusion", fusion } };
}

function parseError(
	code: BoostParseErrorCode,
	message: string,
): BoostParseResult {
	return { ok: false, error: { code, message } };
}

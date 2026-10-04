/** Provider payload override hook for one-shot child team model calls. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeGenerationParameters } from "./provider-payload.js";
import type { GenerationParameterValue } from "./types.js";

export const PROVIDER_PARAMETERS_ENV = "PI_LLM_TEAM_GENERATION_PARAMETERS";

function isParameterValue(value: unknown): value is GenerationParameterValue {
	return ["boolean", "number", "string"].includes(typeof value);
}

function parseParameters(): Record<string, GenerationParameterValue> {
	const raw = process.env[PROVIDER_PARAMETERS_ENV];
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const result: Record<string, GenerationParameterValue> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (isParameterValue(value)) result[key] = value;
		}
		return result;
	} catch {
		return {};
	}
}

export default function (pi: ExtensionAPI) {
	const parameters = parseParameters();
	if (Object.keys(parameters).length === 0) return;
	pi.on("before_provider_request", (event) =>
		mergeGenerationParameters(event.payload, parameters),
	);
}

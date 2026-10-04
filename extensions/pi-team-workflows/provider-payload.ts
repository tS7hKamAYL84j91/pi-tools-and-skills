/**
 * Provider payload helpers for team child model calls.
 *
 * Some OpenAI-compatible providers reject `tools: []`; no-tools requests must
 * omit the field entirely while preserving non-empty tool definitions.
 */
import type { GenerationParameterValue } from "./types.js";

export function omitEmptyTools(payload: unknown): unknown {
	if (!isRecord(payload) || !Object.hasOwn(payload, "tools")) {
		return payload;
	}

	const tools = payload.tools;
	if (!Array.isArray(tools) || tools.length > 0) {
		return payload;
	}

	const sanitized = { ...payload };
	delete sanitized.tools;
	return sanitized;
}

export function mergeGenerationParameters(
	payload: unknown,
	parameters: Record<string, GenerationParameterValue>,
): unknown {
	if (!isRecord(payload) || Object.keys(parameters).length === 0) {
		return payload;
	}
	if (isCloudCodeAssistPayload(payload)) {
		return mergeCloudCodeAssistParameters(payload, parameters);
	}
	if (isGoogleGenerateContentPayload(payload)) {
		return mergeGoogleGenerateContentParameters(payload, parameters);
	}
	if (isOpenAiCompatiblePayload(payload)) {
		return mergeOpenAiCompatibleParameters(payload, parameters);
	}
	return payload;
}

function isCloudCodeAssistPayload(payload: Record<string, unknown>): boolean {
	return isRecord(payload.request) && Array.isArray(payload.request.contents);
}

function mergeCloudCodeAssistParameters(
	payload: Record<string, unknown>,
	parameters: Record<string, GenerationParameterValue>,
): Record<string, unknown> {
	const request = isRecord(payload.request) ? payload.request : {};
	const generationConfig = isRecord(request.generationConfig)
		? request.generationConfig
		: {};
	return {
		...payload,
		request: {
			...request,
			generationConfig: {
				...generationConfig,
				...mapMaxTokens(parameters, "maxOutputTokens"),
			},
		},
	};
}

function isGoogleGenerateContentPayload(payload: Record<string, unknown>): boolean {
	return Array.isArray(payload.contents);
}

function isOpenAiCompatiblePayload(payload: Record<string, unknown>): boolean {
	return Array.isArray(payload.messages) || Object.hasOwn(payload, "input");
}

function mergeOpenAiCompatibleParameters(
	payload: Record<string, unknown>,
	parameters: Record<string, GenerationParameterValue>,
): Record<string, unknown> {
	const maxTokensKey = Object.hasOwn(payload, "input") ? "max_output_tokens" : "max_tokens";
	return { ...payload, ...filterRootParameters(payload, mapMaxTokens(parameters, maxTokensKey)) };
}

function mapMaxTokens(
	parameters: Record<string, GenerationParameterValue>,
	providerKey: "maxOutputTokens" | "max_output_tokens" | "max_tokens",
): Record<string, GenerationParameterValue> {
	if (!Object.hasOwn(parameters, "maxTokens")) return parameters;
	const mapped = { ...parameters };
	const maxTokens = mapped.maxTokens;
	delete mapped.maxTokens;
	if (!Object.hasOwn(mapped, providerKey) && maxTokens !== undefined) {
		mapped[providerKey] = maxTokens;
	}
	return mapped;
}

function filterRootParameters(
	payload: Record<string, unknown>,
	parameters: Record<string, GenerationParameterValue>,
): Record<string, GenerationParameterValue> {
	const safeParameters = { ...parameters };
	if (modelDisallowsTemperature(payload.model) && Object.hasOwn(safeParameters, "temperature")) {
		delete safeParameters.temperature;
	}
	if (isCodexPayload(payload) && Object.hasOwn(safeParameters, "max_output_tokens")) {
		delete safeParameters.max_output_tokens;
	}
	return safeParameters;
}

function modelDisallowsTemperature(model: unknown): boolean {
	return typeof model === "string" && model.toLowerCase().includes("gpt-5");
}

function isCodexPayload(payload: Record<string, unknown>): boolean {
	// Pi's Codex transport emits both top-level instructions and text settings;
	// standard Responses payloads may use either field independently.
	return Object.hasOwn(payload, "instructions") && isRecord(payload.text);
}

function mergeGoogleGenerateContentParameters(
	payload: Record<string, unknown>,
	parameters: Record<string, GenerationParameterValue>,
): Record<string, unknown> {
	const config = isRecord(payload.config) ? payload.config : {};
	return {
		...payload,
		config: {
			...config,
			...mapMaxTokens(parameters, "maxOutputTokens"),
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

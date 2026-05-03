/**
 * Provider payload helpers for council child model calls.
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
				...parameters,
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
	return { ...payload, ...filterRootParameters(payload, parameters) };
}

function filterRootParameters(
	payload: Record<string, unknown>,
	parameters: Record<string, GenerationParameterValue>,
): Record<string, GenerationParameterValue> {
	const safeParameters = { ...parameters };
	if (modelDisallowsTemperature(payload.model) && Object.hasOwn(safeParameters, "temperature")) {
		delete safeParameters.temperature;
	}
	return safeParameters;
}

function modelDisallowsTemperature(model: unknown): boolean {
	return typeof model === "string" && model.toLowerCase().includes("gpt-5");
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
			...parameters,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

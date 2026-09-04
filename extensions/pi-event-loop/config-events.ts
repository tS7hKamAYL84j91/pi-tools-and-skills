/** Event and command validators for .pi/event-loop.json (SPEC §6, §18). */

import {
	checkUnknownKeys,
	isNonEmptyString,
	isRecord,
	isStringArray,
} from "./config-guards.js";
import type { CommandSpec, EventSpec } from "./types.js";

const EVENT_KEYS = [
	"description",
	"allowAgentEmit",
	"requiredPayload",
	"allowWithoutCommand",
] as const;
const COMMAND_KEYS = ["message", "expectedEvents"] as const;

export function validateEventSpec(
	path: string,
	raw: unknown,
	errors: string[],
): EventSpec | undefined {
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return undefined;
	}
	let valid = checkUnknownKeys(raw, EVENT_KEYS, path, errors);

	const description = raw["description"];
	const hasDescription = isNonEmptyString(description);
	if (!hasDescription) {
		errors.push(`${path}: "description" must be a non-empty string`);
		valid = false;
	}

	const allowAgentEmit = raw["allowAgentEmit"];
	if (typeof allowAgentEmit !== "boolean") {
		errors.push(`${path}: "allowAgentEmit" must be a boolean`);
		valid = false;
	}

	const requiredPayload: string[] = [];
	const requiredPayloadRaw = raw["requiredPayload"];
	if (requiredPayloadRaw !== undefined) {
		if (isStringArray(requiredPayloadRaw)) {
			for (const entry of requiredPayloadRaw as string[]) {
				if (requiredPayload.includes(entry)) {
					errors.push(`${path}: duplicate requiredPayload entry "${entry}"`);
					valid = false;
					continue;
				}
				requiredPayload.push(entry);
			}
		} else {
			errors.push(
				`${path}: "requiredPayload" must be an array of non-empty strings`,
			);
			valid = false;
		}
	}

	const rawAllowWithoutCommand = raw["allowWithoutCommand"];
	let allowWithoutCommand: boolean | undefined;
	if (typeof rawAllowWithoutCommand === "boolean") {
		allowWithoutCommand = rawAllowWithoutCommand;
	} else if (rawAllowWithoutCommand !== undefined) {
		errors.push(`${path}: "allowWithoutCommand" must be a boolean`);
		valid = false;
	}

	if (!valid || !hasDescription || typeof allowAgentEmit !== "boolean") {
		return undefined;
	}
	if (allowWithoutCommand === undefined) {
		return { description, allowAgentEmit, requiredPayload };
	}
	return { description, allowAgentEmit, requiredPayload, allowWithoutCommand };
}

export function validateCommandSpec(
	path: string,
	raw: unknown,
	errors: string[],
): CommandSpec | undefined {
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return undefined;
	}
	let valid = checkUnknownKeys(raw, COMMAND_KEYS, path, errors);

	const message = raw["message"];
	const hasMessage = isNonEmptyString(message);
	if (!hasMessage) {
		errors.push(`${path}: "message" must be a non-empty string`);
		valid = false;
	}

	const expectedEvents: string[] = [];
	const expectedRaw = raw["expectedEvents"];
	if (isStringArray(expectedRaw) && expectedRaw.length > 0) {
		for (const entry of expectedRaw as string[]) {
			if (expectedEvents.includes(entry)) {
				errors.push(`${path}: duplicate expectedEvents entry "${entry}"`);
				valid = false;
				continue;
			}
			expectedEvents.push(entry);
		}
	} else {
		errors.push(
			`${path}: "expectedEvents" must be a non-empty array of non-empty strings`,
		);
		valid = false;
	}

	if (!valid || !hasMessage) {
		return undefined;
	}
	return { message, expectedEvents };
}

/** View, rule and automation validators for .pi/event-loop.json (SPEC §6, §18). */

import {
	checkUnknownKeys,
	isNonEmptyString,
	isRecord,
} from "./config-guards.js";
import { isValidJsonPointer } from "./json-pointer.js";
import type { AutomationSpec, ProjectionRule, ViewSpec } from "./types.js";

const VIEW_KEYS = ["type", "openOn", "closeOn"] as const;
const RULE_KEYS = ["event", "keyFrom"] as const;
const AUTOMATION_KEYS = ["id", "view", "issue"] as const;

export function validateViewSpec(
	path: string,
	raw: unknown,
	errors: string[],
): ViewSpec | undefined {
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return undefined;
	}
	let valid = checkUnknownKeys(raw, VIEW_KEYS, path, errors);

	const type = raw["type"];
	if (type !== "todo") {
		errors.push(`${path}: "type" must be "todo"`);
		valid = false;
	}

	const openOn = validateRules(`${path}.openOn`, raw["openOn"], errors);
	if (openOn === undefined) {
		valid = false;
	} else if (openOn.length === 0) {
		errors.push(`${path}: "openOn" must contain at least one rule`);
		valid = false;
	}

	const closeOn = validateRules(`${path}.closeOn`, raw["closeOn"], errors);
	if (closeOn === undefined) {
		valid = false;
	} else if (closeOn.length === 0) {
		errors.push(`${path}: "closeOn" must contain at least one rule`);
		valid = false;
	}

	if (!valid || openOn === undefined || closeOn === undefined) {
		return undefined;
	}
	return { type: "todo", openOn, closeOn };
}

function validateRules(
	path: string,
	raw: unknown,
	errors: string[],
): ProjectionRule[] | undefined {
	if (!Array.isArray(raw)) {
		errors.push(`${path}: must be an array`);
		return undefined;
	}
	const rules: ProjectionRule[] = [];
	let valid = true;
	for (const [index, ruleRaw] of raw.entries()) {
		const rulePath = `${path}[${index}]`;
		if (!isRecord(ruleRaw)) {
			errors.push(`${rulePath}: must be an object`);
			valid = false;
			continue;
		}
		let ruleValid = checkUnknownKeys(ruleRaw, RULE_KEYS, rulePath, errors);

		const event = ruleRaw["event"];
		const hasEvent = isNonEmptyString(event);
		if (!hasEvent) {
			errors.push(`${rulePath}: "event" must be a non-empty string`);
			ruleValid = false;
		}

		const keyFrom = ruleRaw["keyFrom"];
		if (typeof keyFrom !== "string" || !isValidJsonPointer(keyFrom)) {
			errors.push(`${rulePath}: "keyFrom" must be a valid JSON Pointer`);
			ruleValid = false;
		}

		if (!ruleValid || !hasEvent || typeof keyFrom !== "string") {
			valid = false;
			continue;
		}
		rules.push({ event: event, keyFrom });
	}
	return valid ? rules : undefined;
}

export function validateAutomation(
	path: string,
	raw: unknown,
	errors: string[],
): AutomationSpec | undefined {
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return undefined;
	}
	let valid = checkUnknownKeys(raw, AUTOMATION_KEYS, path, errors);

	const id = raw["id"];
	const view = raw["view"];
	const issue = raw["issue"];
	for (const [field, value] of [
		["id", id],
		["view", view],
		["issue", issue],
	] as const) {
		if (!isNonEmptyString(value)) {
			errors.push(`${path}: "${field}" must be a non-empty string`);
			valid = false;
		}
	}
	if (
		!valid ||
		!isNonEmptyString(id) ||
		!isNonEmptyString(view) ||
		!isNonEmptyString(issue)
	) {
		return undefined;
	}
	return { id, view, issue };
}

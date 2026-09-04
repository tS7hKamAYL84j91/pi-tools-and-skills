/** Profile validator for .pi/event-loop.json: per-profile slices and structural parsing (SPEC §6, §18). */

import { validateCommandSpec, validateEventSpec } from "./config-events.js";
import { checkUnknownKeys, isRecord } from "./config-guards.js";
import { validateProfileCrossReferences } from "./config-profile-crossref.js";
import { validateTimer } from "./config-timers.js";
import { validateAutomation, validateViewSpec } from "./config-views.js";
import type {
	AutomationSpec,
	CommandSpec,
	EventSpec,
	ProfileConfig,
	TimerSpec,
	ViewSpec,
} from "./types.js";

const PROFILE_KEYS = [
	"emissionPolicy",
	"events",
	"commands",
	"views",
	"automations",
	"timers",
] as const;

interface ParseResult<T> {
	readonly value: T;
	readonly names: ReadonlySet<string>;
	readonly valid: boolean;
}

function parseProfileEvents(
	path: string,
	raw: unknown,
	errors: string[],
): ParseResult<Record<string, EventSpec>> {
	const names = new Set<string>(isRecord(raw) ? Object.keys(raw) : []);
	const events: Record<string, EventSpec> = {};
	if (!isRecord(raw)) {
		errors.push(`${path}.events: must be an object`);
		return { value: events, names, valid: false };
	}
	let valid = true;
	for (const [name, entryRaw] of Object.entries(raw)) {
		const spec = validateEventSpec(`${path}.events.${name}`, entryRaw, errors);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		events[name] = spec;
	}
	return { value: events, names, valid };
}

function parseProfileCommands(
	path: string,
	raw: unknown,
	errors: string[],
): ParseResult<Record<string, CommandSpec>> {
	const names = new Set<string>(isRecord(raw) ? Object.keys(raw) : []);
	const commands: Record<string, CommandSpec> = {};
	if (!isRecord(raw)) {
		errors.push(`${path}.commands: must be an object`);
		return { value: commands, names, valid: false };
	}
	let valid = true;
	for (const [name, entryRaw] of Object.entries(raw)) {
		const spec = validateCommandSpec(
			`${path}.commands.${name}`,
			entryRaw,
			errors,
		);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		commands[name] = spec;
	}
	return { value: commands, names, valid };
}

function parseProfileViews(
	path: string,
	raw: unknown,
	errors: string[],
): ParseResult<Record<string, ViewSpec>> {
	const names = new Set<string>(isRecord(raw) ? Object.keys(raw) : []);
	const views: Record<string, ViewSpec> = {};
	if (!isRecord(raw)) {
		errors.push(`${path}.views: must be an object`);
		return { value: views, names, valid: false };
	}
	let valid = true;
	for (const [name, entryRaw] of Object.entries(raw)) {
		const spec = validateViewSpec(`${path}.views.${name}`, entryRaw, errors);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		views[name] = spec;
	}
	return { value: views, names, valid };
}

function parseProfileAutomations(
	path: string,
	raw: unknown,
	errors: string[],
): { readonly automations: AutomationSpec[]; readonly valid: boolean } {
	const automations: AutomationSpec[] = [];
	if (!Array.isArray(raw)) {
		errors.push(`${path}.automations: must be an array`);
		return { automations, valid: false };
	}
	let valid = true;
	const seenIds = new Set<string>();
	for (const [index, entryRaw] of raw.entries()) {
		const spec = validateAutomation(
			`${path}.automations[${index}]`,
			entryRaw,
			errors,
		);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		if (seenIds.has(spec.id)) {
			errors.push(
				`${path}.automations[${index}]: duplicate automation id "${spec.id}"`,
			);
			valid = false;
			continue;
		}
		seenIds.add(spec.id);
		automations.push(spec);
	}
	return { automations, valid };
}

function parseProfileTimers(
	path: string,
	raw: unknown,
	errors: string[],
): { readonly timers: TimerSpec[]; readonly valid: boolean } {
	const timers: TimerSpec[] = [];
	if (!Array.isArray(raw)) {
		errors.push(`${path}.timers: must be an array`);
		return { timers, valid: false };
	}
	let valid = true;
	const seenIds = new Set<string>();
	for (const [index, entryRaw] of raw.entries()) {
		const spec = validateTimer(`${path}.timers[${index}]`, entryRaw, errors);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		if (seenIds.has(spec.id)) {
			errors.push(`${path}.timers[${index}]: duplicate timer id "${spec.id}"`);
			valid = false;
			continue;
		}
		seenIds.add(spec.id);
		timers.push(spec);
	}
	return { timers, valid };
}

export function validateProfile(
	name: string,
	raw: unknown,
	errors: string[],
): ProfileConfig | undefined {
	const path = `profiles.${name}`;
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return undefined;
	}
	let valid = checkUnknownKeys(raw, PROFILE_KEYS, path, errors);

	const emissionPolicy = raw["emissionPolicy"];
	if (emissionPolicy !== "command-contract") {
		errors.push(`${path}: "emissionPolicy" must be "command-contract"`);
		valid = false;
	}

	const parsedEvents = parseProfileEvents(path, raw["events"], errors);
	const parsedCommands = parseProfileCommands(path, raw["commands"], errors);
	const parsedViews = parseProfileViews(path, raw["views"], errors);
	const parsedAutomations = parseProfileAutomations(
		path,
		raw["automations"],
		errors,
	);
	const parsedTimers = parseProfileTimers(path, raw["timers"], errors);

	if (
		!parsedEvents.valid ||
		!parsedCommands.valid ||
		!parsedViews.valid ||
		!parsedAutomations.valid ||
		!parsedTimers.valid
	) {
		valid = false;
	}

	const crossRefsValid = validateProfileCrossReferences(
		{
			path,
			eventNames: parsedEvents.names,
			events: parsedEvents.value,
			commandNames: parsedCommands.names,
			commands: parsedCommands.value,
			viewNames: parsedViews.names,
			views: parsedViews.value,
			automations: parsedAutomations.automations,
			timers: parsedTimers.timers,
		},
		errors,
	);

	if (!valid || !crossRefsValid) {
		return undefined;
	}

	return {
		emissionPolicy: "command-contract",
		events: parsedEvents.value,
		commands: parsedCommands.value,
		views: parsedViews.value,
		automations: parsedAutomations.automations,
		timers: parsedTimers.timers,
	};
}

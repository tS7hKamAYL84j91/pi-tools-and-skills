/** Profile validator for .pi/event-loop.json: per-profile slices and structural parsing (SPEC §6, §18). */

import { validateCommandSpec, validateEventSpec } from "./config-events.js";
import { checkUnknownKeys, isRecord } from "./config-guards.js";
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

function parseProfileRecord<T>(
	path: string,
	raw: unknown,
	validator: (path: string, entry: unknown, errors: string[]) => T | undefined,
	errors: string[],
): ParseResult<Record<string, T>> {
	const names = new Set<string>(isRecord(raw) ? Object.keys(raw) : []);
	const result: Record<string, T> = {};
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return { value: result, names, valid: false };
	}
	let valid = true;
	for (const [name, entryRaw] of Object.entries(raw)) {
		const spec = validator(`${path}.${name}`, entryRaw, errors);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		result[name] = spec;
	}
	return { value: result, names, valid };
}

function parseProfileList<T extends { readonly id: string }>(
	path: string,
	raw: unknown,
	itemLabel: string,
	validator: (path: string, entry: unknown, errors: string[]) => T | undefined,
	errors: string[],
): { readonly items: T[]; readonly valid: boolean } {
	const items: T[] = [];
	if (!Array.isArray(raw)) {
		errors.push(`${path}: must be an array`);
		return { items, valid: false };
	}
	let valid = true;
	const seenIds = new Set<string>();
	for (const [index, entryRaw] of raw.entries()) {
		const spec = validator(`${path}[${index}]`, entryRaw, errors);
		if (spec === undefined) {
			valid = false;
			continue;
		}
		if (seenIds.has(spec.id)) {
			errors.push(`${path}[${index}]: duplicate ${itemLabel} id "${spec.id}"`);
			valid = false;
			continue;
		}
		seenIds.add(spec.id);
		items.push(spec);
	}
	return { items, valid };
}

interface ProfileSlices {
	readonly path: string;
	readonly eventNames: ReadonlySet<string>;
	readonly events: Readonly<Record<string, EventSpec>>;
	readonly commandNames: ReadonlySet<string>;
	readonly commands: Readonly<Record<string, CommandSpec>>;
	readonly viewNames: ReadonlySet<string>;
	readonly views: Readonly<Record<string, ViewSpec>>;
	readonly automations: readonly AutomationSpec[];
	readonly timers: readonly TimerSpec[];
}

function validateCommandCrossReferences(slices: ProfileSlices, errors: string[]): boolean {
	let valid = true;
	const { path, commands, events, eventNames } = slices;
	for (const [commandName, command] of Object.entries(commands)) {
		for (const eventName of command.expectedEvents) {
			if (!eventNames.has(eventName)) {
				errors.push(`${path}.commands.${commandName}: expected event "${eventName}" is not defined`);
				valid = false;
				continue;
			}
			const eventSpec = events[eventName];
			if (eventSpec !== undefined && !eventSpec.allowAgentEmit) {
				errors.push(`${path}.commands.${commandName}: expected event "${eventName}" does not allow agent emission`);
				valid = false;
			}
		}
	}
	return valid;
}

function validateViewCrossReferences(slices: ProfileSlices, errors: string[]): boolean {
	let valid = true;
	const { path, views, eventNames } = slices;
	for (const [viewName, view] of Object.entries(views)) {
		const openKeys = new Set<string>();
		for (const rule of view.openOn) {
			if (!eventNames.has(rule.event)) {
				errors.push(`${path}.views.${viewName}: openOn event "${rule.event}" is not defined`);
				valid = false;
			}
			openKeys.add(rule.keyFrom);
		}
		for (const rule of view.closeOn) {
			if (!eventNames.has(rule.event)) {
				errors.push(`${path}.views.${viewName}: closeOn event "${rule.event}" is not defined`);
				valid = false;
			}
			if (!openKeys.has(rule.keyFrom)) {
				errors.push(`${path}.views.${viewName}: closeOn keyFrom "${rule.keyFrom}" does not match any openOn key path`);
				valid = false;
			}
		}
	}
	return valid;
}

function validateAutomationCrossReferences(slices: ProfileSlices, errors: string[]): boolean {
	let valid = true;
	const { path, automations, views, commands, viewNames, commandNames } = slices;
	for (const automation of automations) {
		if (!viewNames.has(automation.view)) {
			errors.push(`${path}.automations.${automation.id}: view "${automation.view}" is not defined`);
			valid = false;
		}
		if (!commandNames.has(automation.issue)) {
			errors.push(`${path}.automations.${automation.id}: command "${automation.issue}" is not defined`);
			valid = false;
		}
		const view = views[automation.view];
		const command = commands[automation.issue];
		if (view !== undefined && command !== undefined) {
			const closeEvents = new Set(view.closeOn.map((rule) => rule.event));
			for (const expectedEvent of command.expectedEvents) {
				if (!closeEvents.has(expectedEvent)) {
					errors.push(`${path}.automations.${automation.id}: command "${automation.issue}" expected event "${expectedEvent}" does not close view "${automation.view}"`);
					valid = false;
				}
			}
		}
	}
	return valid;
}

function validateTimerCrossReferences(slices: ProfileSlices, errors: string[]): boolean {
	let valid = true;
	const { path, timers, eventNames } = slices;
	for (const timer of timers) {
		if (!eventNames.has(timer.emit)) {
			errors.push(`${path}.timers.${timer.id}: emit event "${timer.emit}" is not defined`);
			valid = false;
		}
	}
	return valid;
}

/** Private cross-slice reference and automation contract validator (SPEC §18). */
function validateProfileCrossReferences(slices: ProfileSlices, errors: string[]): boolean {
	const commandsValid = validateCommandCrossReferences(slices, errors);
	const viewsValid = validateViewCrossReferences(slices, errors);
	const automationsValid = validateAutomationCrossReferences(slices, errors);
	const timersValid = validateTimerCrossReferences(slices, errors);
	return commandsValid && viewsValid && automationsValid && timersValid;
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

	const parsedEvents = parseProfileRecord(`${path}.events`, raw["events"], validateEventSpec, errors);
	const parsedCommands = parseProfileRecord(`${path}.commands`, raw["commands"], validateCommandSpec, errors);
	const parsedViews = parseProfileRecord(`${path}.views`, raw["views"], validateViewSpec, errors);
	const parsedAutomations = parseProfileList(`${path}.automations`, raw["automations"], "automation", validateAutomation, errors);
	const parsedTimers = parseProfileList(`${path}.timers`, raw["timers"], "timer", validateTimer, errors);

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
			automations: parsedAutomations.items,
			timers: parsedTimers.items,
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
		automations: parsedAutomations.items,
		timers: parsedTimers.items,
	};
}

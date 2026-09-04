/** Profile validator for .pi/event-loop.json: per-profile slices and cross-reference checks (SPEC §6, §18). */

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

	const eventsRaw = raw["events"];
	const eventNames = new Set<string>(
		isRecord(eventsRaw) ? Object.keys(eventsRaw) : [],
	);
	const events: Record<string, EventSpec> = {};
	if (isRecord(eventsRaw)) {
		for (const [eventName, eventRaw] of Object.entries(eventsRaw)) {
			const spec = validateEventSpec(
				`${path}.events.${eventName}`,
				eventRaw,
				errors,
			);
			if (spec === undefined) {
				valid = false;
				continue;
			}
			events[eventName] = spec;
		}
	} else {
		errors.push(`${path}: "events" must be an object`);
		valid = false;
	}

	const commandsRaw = raw["commands"];
	const commandNames = new Set<string>(
		isRecord(commandsRaw) ? Object.keys(commandsRaw) : [],
	);
	const commands: Record<string, CommandSpec> = {};
	if (isRecord(commandsRaw)) {
		for (const [commandName, commandRaw] of Object.entries(commandsRaw)) {
			const spec = validateCommandSpec(
				`${path}.commands.${commandName}`,
				commandRaw,
				errors,
			);
			if (spec === undefined) {
				valid = false;
				continue;
			}
			commands[commandName] = spec;
		}
	} else {
		errors.push(`${path}: "commands" must be an object`);
		valid = false;
	}

	const viewsRaw = raw["views"];
	const viewNames = new Set<string>(
		isRecord(viewsRaw) ? Object.keys(viewsRaw) : [],
	);
	const views: Record<string, ViewSpec> = {};
	if (isRecord(viewsRaw)) {
		for (const [viewName, viewRaw] of Object.entries(viewsRaw)) {
			const spec = validateViewSpec(
				`${path}.views.${viewName}`,
				viewRaw,
				errors,
			);
			if (spec === undefined) {
				valid = false;
				continue;
			}
			views[viewName] = spec;
		}
	} else {
		errors.push(`${path}: "views" must be an object`);
		valid = false;
	}

	const automationsRaw = raw["automations"];
	const automations: AutomationSpec[] = [];
	const seenAutomationIds = new Set<string>();
	if (Array.isArray(automationsRaw)) {
		for (const [index, automationRaw] of automationsRaw.entries()) {
			const spec = validateAutomation(
				`${path}.automations[${index}]`,
				automationRaw,
				errors,
			);
			if (spec === undefined) {
				valid = false;
				continue;
			}
			if (seenAutomationIds.has(spec.id)) {
				errors.push(
					`${path}.automations[${index}]: duplicate automation id "${spec.id}"`,
				);
				valid = false;
				continue;
			}
			seenAutomationIds.add(spec.id);
			automations.push(spec);
		}
	} else {
		errors.push(`${path}: "automations" must be an array`);
		valid = false;
	}

	const timersRaw = raw["timers"];
	const timers: TimerSpec[] = [];
	const seenTimerIds = new Set<string>();
	if (Array.isArray(timersRaw)) {
		for (const [index, timerRaw] of timersRaw.entries()) {
			const spec = validateTimer(`${path}.timers[${index}]`, timerRaw, errors);
			if (spec === undefined) {
				valid = false;
				continue;
			}
			if (seenTimerIds.has(spec.id)) {
				errors.push(
					`${path}.timers[${index}]: duplicate timer id "${spec.id}"`,
				);
				valid = false;
				continue;
			}
			seenTimerIds.add(spec.id);
			timers.push(spec);
		}
	} else {
		errors.push(`${path}: "timers" must be an array`);
		valid = false;
	}

	// Cross-references (SPEC §18): defined-name sets tolerate entries that were
	// themselves invalid, so cross-reference errors stay meaningful. Cross-reference
	// checks run even when structural errors exist, so reference mistakes surface
	// alongside the structural errors in the same result.
	for (const [commandName, command] of Object.entries(commands)) {
		for (const eventName of command.expectedEvents) {
			if (!eventNames.has(eventName)) {
				errors.push(
					`${path}.commands.${commandName}: expected event "${eventName}" is not defined`,
				);
				valid = false;
			}
		}
	}
	for (const [viewName, view] of Object.entries(views)) {
		const openKeys = new Set<string>();
		for (const rule of view.openOn) {
			if (!eventNames.has(rule.event)) {
				errors.push(
					`${path}.views.${viewName}: openOn event "${rule.event}" is not defined`,
				);
				valid = false;
			}
			openKeys.add(rule.keyFrom);
		}
		for (const rule of view.closeOn) {
			if (!eventNames.has(rule.event)) {
				errors.push(
					`${path}.views.${viewName}: closeOn event "${rule.event}" is not defined`,
				);
				valid = false;
			}
			if (!openKeys.has(rule.keyFrom)) {
				errors.push(
					`${path}.views.${viewName}: closeOn keyFrom "${rule.keyFrom}" does not match any openOn key path`,
				);
				valid = false;
			}
		}
	}
	for (const automation of automations) {
		if (!viewNames.has(automation.view)) {
			errors.push(
				`${path}.automations.${automation.id}: view "${automation.view}" is not defined`,
			);
			valid = false;
		}
		if (!commandNames.has(automation.issue)) {
			errors.push(
				`${path}.automations.${automation.id}: command "${automation.issue}" is not defined`,
			);
			valid = false;
		}
	}
	for (const timer of timers) {
		if (!eventNames.has(timer.emit)) {
			errors.push(
				`${path}.timers.${timer.id}: emit event "${timer.emit}" is not defined`,
			);
			valid = false;
		}
	}

	if (!valid) {
		return undefined;
	}
	return {
		emissionPolicy: "command-contract",
		events,
		commands,
		views,
		automations,
		timers,
	};
}

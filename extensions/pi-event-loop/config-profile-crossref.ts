/** Cross-slice validation for .pi/event-loop.json profile configurations (SPEC §6, §18). */

import type {
	AutomationSpec,
	CommandSpec,
	EventSpec,
	TimerSpec,
	ViewSpec,
} from "./types.js";

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

function validateCommandCrossReferences(
	slices: ProfileSlices,
	errors: string[],
): boolean {
	let valid = true;
	const { path, commands, events, eventNames } = slices;
	for (const [commandName, command] of Object.entries(commands)) {
		for (const eventName of command.expectedEvents) {
			if (!eventNames.has(eventName)) {
				errors.push(
					`${path}.commands.${commandName}: expected event "${eventName}" is not defined`,
				);
				valid = false;
				continue;
			}
			const eventSpec = events[eventName];
			if (eventSpec !== undefined && !eventSpec.allowAgentEmit) {
				errors.push(
					`${path}.commands.${commandName}: expected event "${eventName}" does not allow agent emission`,
				);
				valid = false;
			}
		}
	}
	return valid;
}

function validateViewCrossReferences(
	slices: ProfileSlices,
	errors: string[],
): boolean {
	let valid = true;
	const { path, views, eventNames } = slices;
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
	return valid;
}

function validateAutomationCrossReferences(
	slices: ProfileSlices,
	errors: string[],
): boolean {
	let valid = true;
	const { path, automations, views, commands, viewNames, commandNames } = slices;
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
		const view = views[automation.view];
		const command = commands[automation.issue];
		if (view !== undefined && command !== undefined) {
			const closeEvents = new Set(view.closeOn.map((rule) => rule.event));
			for (const expectedEvent of command.expectedEvents) {
				if (!closeEvents.has(expectedEvent)) {
					errors.push(
						`${path}.automations.${automation.id}: command "${automation.issue}" expected event "${expectedEvent}" does not close view "${automation.view}"`,
					);
					valid = false;
				}
			}
		}
	}
	return valid;
}

function validateTimerCrossReferences(
	slices: ProfileSlices,
	errors: string[],
): boolean {
	let valid = true;
	const { path, timers, eventNames } = slices;
	for (const timer of timers) {
		if (!eventNames.has(timer.emit)) {
			errors.push(
				`${path}.timers.${timer.id}: emit event "${timer.emit}" is not defined`,
			);
			valid = false;
		}
	}
	return valid;
}

/** Validate cross-slice references and automation contracts (SPEC §18). */
export function validateProfileCrossReferences(
	slices: ProfileSlices,
	errors: string[],
): boolean {
	const commandsValid = validateCommandCrossReferences(slices, errors);
	const viewsValid = validateViewCrossReferences(slices, errors);
	const automationsValid = validateAutomationCrossReferences(slices, errors);
	const timersValid = validateTimerCrossReferences(slices, errors);

	return commandsValid && viewsValid && automationsValid && timersValid;
}

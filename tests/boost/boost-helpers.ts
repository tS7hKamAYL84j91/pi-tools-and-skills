/** Shared fixtures for boost command and host-injection tests. */
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { type MockedFunction, vi } from "vitest";
import {
	type BoostCommandIdentity,
	registerBoostCommand,
} from "../../extensions/pi-boost/boost/command.js";
import type {
	BoostActor,
	BoostLeaseStatus,
	BoostRequest,
	BoostResult,
	BoostSubject,
	ReserveBoostInput,
	ResetBoostInput,
} from "../../extensions/pi-boost/boost/contracts.js";
import type { BoostParseResult } from "../../extensions/pi-boost/boost/boost-parse-types.js";
import {
	combineBoostInput,
	parseBoostCommand,
} from "../../extensions/pi-boost/boost/parser.js";

export const PRINCIPAL: BoostActor = {
	kind: "principal",
	issuerId: "principal-a",
};
export const AGENT: BoostActor = { kind: "agent", issuerId: "agent-a" };
export const SUBJECT: BoostSubject = {
	subjectId: "subject-a",
	workspace: { workspaceId: "workspace-a", root: "/repo/a" },
};

export function request(overrides: Partial<BoostRequest> = {}): BoostRequest {
	const prompt = overrides.prompt ?? "review this public diff";
	return {
		requestedYields: 1,
		isolation: "current",
		prompt,
		combinedInput: combineBoostInput(prompt),
		...overrides,
	};
}

interface CommandDefinition {
	handler: (
		args: string | undefined,
		ctx: ExtensionCommandContext,
	) => Promise<void>;
}

interface CommandHarnessOverrides {
	identity?: BoostCommandIdentity;
	parse?: (input: string) => BoostParseResult;
	reserve?: (input: ReserveBoostInput) => BoostResult<BoostLeaseStatus>;
	reset?: (input: ResetBoostInput) => BoostResult<BoostLeaseStatus>;
	status?: (actor: BoostActor) => BoostResult<BoostLeaseStatus>;
}

interface CommandNotification {
	message: string;
	level: "info" | "warning" | "error";
}

interface BoostCommandHarness {
	authority: {
		reserve: MockedFunction<
			(input: ReserveBoostInput) => BoostResult<BoostLeaseStatus>
		>;
		reset: MockedFunction<
			(input: ResetBoostInput) => BoostResult<BoostLeaseStatus>
		>;
		getStatus: MockedFunction<
			(actor: BoostActor) => BoostResult<BoostLeaseStatus>
		>;
	};
	dispatch: MockedFunction<
		(status: BoostLeaseStatus) => { dispatched: false; kind: "reserved" }
	>;
	execute(args?: string): Promise<void>;
	identity: MockedFunction<() => BoostCommandIdentity | undefined>;
	notifications: CommandNotification[];
	parse: MockedFunction<(input: string) => BoostParseResult>;
}

export function createBoostCommandHarness(
	overrides: CommandHarnessOverrides = {},
): BoostCommandHarness {
	let definition: CommandDefinition | undefined;
	const api = {
		registerCommand: (name: string, command: CommandDefinition) => {
			if (name === "boost") {
				definition = command;
			}
		},
	} as unknown as ExtensionAPI;
	const notifications: CommandNotification[] = [];
	const parse = vi.fn(overrides.parse ?? parseBoostCommand);
	const identity = vi.fn(() =>
		Object.hasOwn(overrides, "identity")
			? overrides.identity
			: { actor: PRINCIPAL, subject: SUBJECT },
	);
	const defaultReservation = (): BoostResult<BoostLeaseStatus> => ({
		ok: true,
		value: {
			state: "Reserved",
			leaseId: "lease-command",
			remainingYields: 1,
			expiresAt: 2_000,
		},
	});
	const defaultReset = (): BoostResult<BoostLeaseStatus> => ({
		ok: true,
		value: { state: "Idle" },
	});
	const authority: BoostCommandHarness["authority"] = {
		reserve: vi.fn(overrides.reserve ?? defaultReservation),
		reset: vi.fn(overrides.reset ?? defaultReset),
		getStatus: vi.fn(overrides.status ?? defaultReservation),
	};
	const dispatch = vi.fn(() => ({
		dispatched: false as const,
		kind: "reserved" as const,
	}));
	registerBoostCommand(api, {
		parse,
		identity,
		authority,
		notify: (_ctx, message, level) => notifications.push({ message, level }),
		dispatch: { recordReservation: dispatch },
	});
	return {
		authority,
		dispatch,
		identity,
		notifications,
		parse,
		execute: async (args) => {
			if (!definition) {
				throw new Error("Boost command was not registered");
			}
			await definition.handler(args, {} as ExtensionCommandContext);
		},
	};
}
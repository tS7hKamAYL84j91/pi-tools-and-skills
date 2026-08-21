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
	BoostAuditRecord,
	BoostGovernanceDecision,
	BoostIsolationAdapter,
	BoostLeaseDependencies,
	BoostLeaseStatus,
	BoostModelIdentity,
	BoostRequest,
	BoostResult,
	BoostSubject,
	BoostTransientContext,
	IsolationContextRequest,
	ReserveBoostInput,
	ResetBoostInput,
} from "../../extensions/pi-boost/boost/contracts.js";
import { BoostGlobalLeaseSlot } from "../../extensions/pi-boost/boost/global-slot.js";
import { BoostLeaseAuthority } from "../../extensions/pi-boost/boost/lease-authority.js";
import type { BoostParseResult } from "../../extensions/pi-boost/boost/boost-parse-types.js";
import {
	combineBoostInput,
	parseBoostCommand,
} from "../../extensions/pi-boost/boost/parser.js";

export const PRINCIPAL: BoostActor = {
	kind: "principal",
	issuerId: "principal-a",
};
export const OTHER_PRINCIPAL: BoostActor = {
	kind: "principal",
	issuerId: "principal-b",
};
export const AGENT: BoostActor = { kind: "agent", issuerId: "agent-a" };
export const SUBJECT: BoostSubject = {
	subjectId: "subject-a",
	workspace: { workspaceId: "workspace-a", root: "/repo/a" },
};

export const BASELINE_MODEL: BoostModelIdentity = {
	provider: "mock-local",
	id: "glm-5.2-test",
	family: "glm-5.2",
	registered: true,
};
export const LEASE_MODEL: BoostModelIdentity = {
	provider: "mock-external",
	id: "sol-ultra-test",
	family: "sol-ultra",
	registered: true,
};

interface BoostHarness {
	authority: BoostLeaseAuthority;
	auditRecords: BoostAuditRecord[];
	clock: { now: number };
	dependencies: BoostLeaseDependencies;
	isolationRequests: IsolationContextRequest[];
	selectedModels: BoostModelIdentity[];
	restoredModels: BoostModelIdentity[];
	slot: BoostGlobalLeaseSlot;
}

interface HarnessOverrides {
	auditAppend?: (record: BoostAuditRecord) => void;
	classify?: BoostLeaseDependencies["governance"]["classify"];
	createContext?: BoostIsolationAdapter["create"];
	disposeContext?: BoostIsolationAdapter["dispose"];
	leaseDurationMs?: number;
	resolveModel?: BoostLeaseDependencies["models"]["resolve"];
	restoreModel?: BoostLeaseDependencies["models"]["restore"];
	selectModel?: BoostLeaseDependencies["models"]["select"];
	slot?: BoostGlobalLeaseSlot;
	validateWorkspace?: BoostLeaseDependencies["workspace"]["revalidate"];
}

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

export function createBoostHarness(
	overrides: HarnessOverrides = {},
): BoostHarness {
	const auditRecords: BoostAuditRecord[] = [];
	const isolationRequests: IsolationContextRequest[] = [];
	const selectedModels: BoostModelIdentity[] = [];
	const restoredModels: BoostModelIdentity[] = [];
	const clock = { now: 1_000 };
	const slot = overrides.slot ?? new BoostGlobalLeaseSlot();
	let nextId = 0;
	const classify =
		overrides.classify ??
		((_input: string): BoostGovernanceDecision => "public");
	const dependencies: BoostLeaseDependencies = {
		audit: {
			append: vi.fn((record: BoostAuditRecord) => {
				auditRecords.push(record);
				overrides.auditAppend?.(record);
			}),
		},
		governance: {
			classify: vi.fn(classify),
		},
		ids: {
			next: vi.fn((kind) => `${kind}-${++nextId}`),
		},
		isolation: {
			create: vi.fn((contextRequest) => {
				isolationRequests.push(contextRequest);
				if (overrides.createContext) {
					return overrides.createContext(contextRequest);
				}
				const context: BoostTransientContext = {
					contextId: `context-${isolationRequests.length}`,
					mode: contextRequest.mode,
					issuerId: contextRequest.issuerId,
					subjectId: contextRequest.subjectId,
					workspace: contextRequest.workspace,
					combinedInput: contextRequest.combinedInput,
					inheritsConversationHistory: contextRequest.mode === "current",
					inheritsHiddenSessionState: false,
					mergeBack: false,
					...(contextRequest.mode === "fresh"
						? { transientSessionId: `fresh-${isolationRequests.length}` }
						: {}),
				};
				return context;
			}),
			dispose: vi.fn(overrides.disposeContext ?? (() => undefined)),
		},
		models: {
			resolve: vi.fn(
				overrides.resolveModel ??
					((key) =>
						key === "principalBoostBaseline" ? BASELINE_MODEL : LEASE_MODEL),
			),
			restore: vi.fn((subjectId, model) => {
				restoredModels.push(model);
				overrides.restoreModel?.(subjectId, model);
			}),
			select: vi.fn((subjectId, model) => {
				selectedModels.push(model);
				overrides.selectModel?.(subjectId, model);
			}),
		},
		now: () => clock.now,
		slot,
		workspace: {
			revalidate: vi.fn(overrides.validateWorkspace ?? (() => true)),
		},
	};
	return {
		authority: new BoostLeaseAuthority(dependencies, {
			leaseDurationMs: overrides.leaseDurationMs ?? 1_000,
		}),
		auditRecords,
		clock,
		dependencies,
		isolationRequests,
		selectedModels,
		restoredModels,
		slot,
	};
}

export function reserve(
	harness: BoostHarness,
	boostRequest: BoostRequest = request(),
): string {
	const result = harness.authority.reserve({
		actor: PRINCIPAL,
		subject: SUBJECT,
		request: boostRequest,
	});
	if (!result.ok) {
		throw new Error(`Reservation failed: ${result.reason}`);
	}
	if (!result.value.leaseId) {
		throw new Error("Reservation did not return a lease id");
	}
	return result.value.leaseId;
}

export function activate(
	harness: BoostHarness,
	leaseId: string,
	prompt?: string,
) {
	return harness.authority.activate({
		actor: PRINCIPAL,
		leaseId,
		...(prompt ? { prompt } : {}),
	});
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

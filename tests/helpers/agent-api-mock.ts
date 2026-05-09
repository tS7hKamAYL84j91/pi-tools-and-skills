import type { MockedFunction } from "vitest";
import type { AgentInfo, findAgentByName } from "../../lib/agent-api.js";
import type { AgentRecord } from "../../lib/agent-registry.js";

type FindAgentByNameMock = MockedFunction<typeof findAgentByName>;

/** Build an AgentInfo fixture from a registry record, mirroring agent-api defaults. */
export function makeAgentInfo(record: AgentRecord, overrides: Partial<AgentInfo> = {}): AgentInfo {
	return {
		id: record.id,
		name: record.name,
		registryName: record.name,
		pid: record.pid,
		alive: true,
		heartbeatAge: Date.now() - record.heartbeat,
		model: record.model,
		status: record.status,
		...overrides,
	};
}

/** Install a name-addressed findAgentByName mock backed by AgentInfo fixtures. */
export function mockFindAgentStates(
	mockFindAgentByName: FindAgentByNameMock,
	records: readonly AgentRecord[],
	overridesByName: Record<string, Partial<AgentInfo>> = {},
): void {
	const states = new Map<string, AgentInfo>();
	for (const record of records) {
		states.set(record.name, makeAgentInfo(record, overridesByName[record.name] ?? {}));
	}
	mockFindAgentByName.mockImplementation((name) => states.get(name) ?? null);
}

import { describe, expect, it, vi } from "vitest";

import {
	OperationalStateStore,
	STATE_ENTRY_TYPE,
	inferWorkspaceIdentity,
	restoreLatestWorkspaceState,
	type OperationalWorkspaceState,
} from "../extensions/pi-panopticon/state.js";

function makeState(overrides: Partial<OperationalWorkspaceState> = {}): OperationalWorkspaceState {
	return {
		version: 1,
		workspaceId: "matrix:jim",
		sourceChannel: "matrix",
		humanIdentity: "jim",
		lastActiveAt: 100,
		linkedPaths: { cwd: "/tmp/project", sessionFile: "/tmp/session.jsonl" },
		pendingFollowUps: [],
		resume: { reason: "resume", previousSessionFile: "/tmp/prev.jsonl" },
		...overrides,
	};
}

function makeCtx(entries: unknown[] = []) {
	return {
		cwd: "/tmp/project",
		sessionManager: {
			getEntries: () => entries,
			getSessionFile: () => "/tmp/session.jsonl",
		},
	};
}

describe("inferWorkspaceIdentity", () => {
	it("maps interactive input to local workspace", () => {
		expect(inferWorkspaceIdentity({ source: "interactive" })).toEqual({
			workspaceId: "local:interactive",
			sourceChannel: "local",
			humanIdentity: "interactive",
		});
	});

	it("maps matrix agent messages to matrix workspace", () => {
		expect(inferWorkspaceIdentity({
			source: "extension",
			text: '<agent-message from="matrix:jim">\nhello\n</agent-message>',
		})).toEqual({
			workspaceId: "matrix:jim",
			sourceChannel: "matrix",
			humanIdentity: "jim",
		});
	});

	it("maps peer agent messages to agent workspace", () => {
		expect(inferWorkspaceIdentity({
			source: "extension",
			text: '<agent-message from="coas">\nhi\n</agent-message>',
		})).toEqual({
			workspaceId: "agent:coas",
			sourceChannel: "agent",
			humanIdentity: "coas",
		});
	});
});

describe("restoreLatestWorkspaceState", () => {
	it("restores the latest matching custom state entry", () => {
		const older = { type: "custom", customType: STATE_ENTRY_TYPE, data: makeState({ lastActiveAt: 10 }) };
		const newer = { type: "custom", customType: STATE_ENTRY_TYPE, data: makeState({ lastActiveAt: 20 }) };
		expect(restoreLatestWorkspaceState([older, newer] as never[])).toEqual(newer.data);
	});
});

describe("OperationalStateStore", () => {
	it("restores state and persists only when changed", () => {
		const appendEntry = vi.fn();
		const store = new OperationalStateStore({ appendEntry } as never);
		const existing = makeState();
		const ctx = makeCtx([{ type: "custom", customType: STATE_ENTRY_TYPE, data: existing }]);

		store.restore(ctx as never, { reason: "resume", previousSessionFile: "/tmp/prev.jsonl" });
		store.recordInput(ctx as never, { source: "extension", text: '<agent-message from="matrix:jim">\nhello\n</agent-message>' });

		expect(store.getState()?.workspaceId).toBe("matrix:jim");
		expect(appendEntry).toHaveBeenCalled();
	});
});

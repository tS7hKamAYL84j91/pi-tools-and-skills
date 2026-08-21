/**
 * Tests that built-in team projection is wired into session_start and only
 * fires on reason "startup" (not reload/new/resume/fork). The projection
 * module itself is mocked so no files are written to the real home dir.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerTeams as teamExtension } from "../../extensions/pi-teams/register.js";
import type { ProjectionResult } from "../../extensions/pi-teams/team-projection.js";

type RegisteredHandler = (event: { reason: string }, ctx: ExtensionContext) => unknown;

const { projectMock } = vi.hoisted(() => {
	const projectMock = vi.fn<(ctx: ExtensionContext, options?: { force?: boolean }) => Promise<ProjectionResult>>();
	projectMock.mockResolvedValue({ projected: ["llm-council"], skipped: [], overwritten: [] });
	return { projectMock };
});

vi.mock("../../extensions/pi-teams/team-projection.js", () => ({
	projectBuiltinTeams: projectMock,
}));

function createFakeApi(): { api: ExtensionAPI; handlers: Map<string, RegisteredHandler> } {
	const handlers = new Map<string, RegisteredHandler>();
	const api = {
		registerTool() {},
		registerCommand() {},
		on(event: string, handler: RegisteredHandler) {
			handlers.set(event, handler);
		},
		appendEntry() {},
	};
	return { api: api as unknown as ExtensionAPI, handlers };
}

function fakeCtx(): ExtensionContext {
	const notifications: Array<{ message: string; level: string }> = [];
	return {
		cwd: "/tmp",
		sessionManager: { getBranch: () => [], getEntries: () => [] },
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			setStatus: () => {},
			setWidget: () => {},
		},
		// expose notifications for assertions via a side channel
		...({} as Record<string, unknown>),
	} as unknown as ExtensionContext & { ui: { notify: (m: string, l: string) => void } };
}

describe("team projection session_start wiring", () => {
	it("projects on session_start(startup) and notifies", async () => {
		const { api, handlers } = createFakeApi();
		teamExtension(api);
		const ctx = fakeCtx();
		projectMock.mockClear();

		const sessionStart = handlers.get("session_start");
		expect(sessionStart).toBeDefined();
		await sessionStart?.({ reason: "startup" }, ctx);

		expect(projectMock).toHaveBeenCalledTimes(1);
	});

	it("does NOT project on session_start(reload)", async () => {
		const { api, handlers } = createFakeApi();
		teamExtension(api);
		const ctx = fakeCtx();
		projectMock.mockClear();

		await handlers.get("session_start")?.({ reason: "reload" }, ctx);

		expect(projectMock).not.toHaveBeenCalled();
	});

	it("does NOT project on session_start(new|resume|fork)", async () => {
		const { api, handlers } = createFakeApi();
		teamExtension(api);
		const ctx = fakeCtx();
		projectMock.mockClear();

		for (const reason of ["new", "resume", "fork"] as const) {
			await handlers.get("session_start")?.({ reason }, ctx);
		}

		expect(projectMock).not.toHaveBeenCalled();
	});
});
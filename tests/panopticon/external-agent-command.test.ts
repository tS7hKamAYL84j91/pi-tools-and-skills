import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { registerExternalAgentCommands } from "../../extensions/pi-panopticon/ui/external-agent-command.js";
import {
	asExtensionApi,
	makeAgentRecord,
	makeMockExtensionApi,
	makeRegistry,
} from "./helpers.js";

const registrarMocks = vi.hoisted(() => ({
	list: vi.fn(),
	register: vi.fn(),
	unregister: vi.fn(),
}));

vi.mock("../../extensions/pi-panopticon/registry/external-registrar.js", () => ({
	listExternalAgents: registrarMocks.list,
	registerExternalAgent: registrarMocks.register,
	unregisterExternalAgent: registrarMocks.unregister,
}));

const EXTERNAL: AgentRecord = {
	id: "ext-worker",
	name: "worker",
	kind: "external",
	pid: 0,
	cwd: "/persist/worker/inbox",
	model: "external",
	startedAt: 1,
	heartbeat: 1,
	status: "waiting",
	mailboxPath: "/persist/worker/inbox",
};

function commandContext() {
	return {
		cwd: "/workspace/project",
		ui: { notify: vi.fn() },
	};
}

afterEach(() => vi.unstubAllEnvs());

describe("external agent commands", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("registers in ctx.cwd and refreshes Registry.readAllPeers immediately", async () => {
		const self = makeAgentRecord({ id: "self", name: "pi-agent" });
		const registry = makeRegistry(self, [self]);
		const api = makeMockExtensionApi();
		registrarMocks.register.mockResolvedValue(EXTERNAL);
		registrarMocks.list.mockResolvedValue([EXTERNAL]);
		registerExternalAgentCommands(asExtensionApi(api), registry);
		const command = api.registeredCommands.get("agent-external-register");

		await command?.handler("worker", commandContext() as never);

		expect(registrarMocks.register).toHaveBeenCalledWith(
			{ workspaceRoot: "/workspace/project" },
			{ name: "worker" },
			[self],
		);
		expect(registry.setExternalPeers).toHaveBeenCalledWith([EXTERNAL]);
	});

	it("uses the same operator-configured shared authority as peer tools", async () => {
		vi.stubEnv("PI_PANOPTICON_EXTERNAL_WORKSPACE_ROOT", "/shared");
		vi.stubEnv("PI_PANOPTICON_EXTERNAL_MAILBOX_ROOT", "/mail");
		const registry = makeRegistry(undefined, []);
		const api = makeMockExtensionApi();
		registrarMocks.register.mockResolvedValue(EXTERNAL);
		registrarMocks.list.mockResolvedValue([EXTERNAL]);
		registerExternalAgentCommands(asExtensionApi(api), registry);
		await api.registeredCommands.get("agent-external-register")?.handler("worker", commandContext() as never);
		expect(registrarMocks.register).toHaveBeenCalledWith({ workspaceRoot: "/shared", mailboxRoot: "/mail" }, { name: "worker" }, []);
		expect(registrarMocks.list).toHaveBeenCalledWith({ workspaceRoot: "/shared", mailboxRoot: "/mail" });
	});

	it("removes only the registration and refreshes current-session peers", async () => {
		const registry = makeRegistry(undefined, [EXTERNAL]);
		const api = makeMockExtensionApi();
		registrarMocks.list
			.mockResolvedValueOnce([EXTERNAL])
			.mockResolvedValueOnce([]);
		registerExternalAgentCommands(asExtensionApi(api), registry);
		const command = api.registeredCommands.get("agent-external-remove");

		await command?.handler("worker", commandContext() as never);

		expect(registrarMocks.unregister).toHaveBeenCalledWith(
			{ workspaceRoot: "/workspace/project" },
			EXTERNAL.id,
		);
		expect(registry.setExternalPeers).toHaveBeenCalledWith([]);
	});
});

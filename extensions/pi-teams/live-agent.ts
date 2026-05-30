/** Live-agent role-node execution for explicit agent:<name> bindings. */

import { randomUUID } from "node:crypto";
import { findAgentByName, listLiveAgents, type AgentInfo } from "../../lib/agent-api.js";
import type { InboundMessage, MessageTransport } from "../../lib/message-transport.js";
import {
	ackRuntimeAgentMessage,
	receiveRuntimeAgentMessages,
	sendRuntimeAgentMessage,
} from "../../lib/runtime-agent-messaging.js";
import type { RuntimeControlPlane, RuntimeEntityRef } from "../../lib/runtime-control-plane.js";
import { getMaildirTransport } from "../../lib/transports/maildir.js";
import type { TeamAgentBinding } from "./team-types.js";
import type { ModelRun } from "./types.js";

const LIVE_AGENT_PREFIX = "agent:";
const RESPONSE_PREFIX = "TEAM_NODE_RESPONSE";
const POLL_INTERVAL_MS = 250;
const STALE_RESPONSE_MS = 24 * 60 * 60 * 1000;

interface LiveAgentRequest {
	id: string;
	role: string;
	label: string;
	systemPrompt: string;
	prompt: string;
	orchestratorName: string;
}

interface LiveAgentDeps {
	findAgent: (name: string) => AgentInfo | null;
	listAgents: () => AgentInfo[];
	transport: MessageTransport;
	requestId: () => string;
	runtime?: RuntimeControlPlane;
}

interface RunLiveAgentNodeArgs {
	binding: TeamAgentBinding;
	model: string;
	prompt: string;
	systemPrompt: string;
	signal: AbortSignal;
	parentId?: string;
	orchestratorName?: string;
	runtimeParent?: RuntimeEntityRef;
}

export function isLiveAgentRef(value: string): boolean {
	return value.toLowerCase().startsWith(LIVE_AGENT_PREFIX) && liveAgentName(value) !== undefined;
}

export function liveAgentName(value: string): string | undefined {
	if (!value.toLowerCase().startsWith(LIVE_AGENT_PREFIX)) return undefined;
	const name = value.slice(LIVE_AGENT_PREFIX.length).trim();
	return name.length > 0 ? name : undefined;
}

export function liveAgentModel(value: string): string | undefined {
	const name = liveAgentName(value);
	return name ? findAgentByName(name)?.model : undefined;
}

export function availableLiveAgentNames(excludeName?: string): string[] {
	return listLiveAgents(excludeName).map((agent) => agent.name).sort((a, b) => a.localeCompare(b));
}

function defaultDeps(): LiveAgentDeps {
	return {
		findAgent: findAgentByName,
		listAgents: () => listLiveAgents(),
		transport: getMaildirTransport(),
		requestId: randomUUID,
	};
}

function availableNames(deps: LiveAgentDeps, excludeName?: string): string {
	const names = deps.listAgents()
		.filter((agent) => !excludeName || agent.name.toLowerCase() !== excludeName.toLowerCase())
		.map((agent) => agent.name)
		.sort((a, b) => a.localeCompare(b));
	return names.join(", ") || "(none)";
}

function assertAvailableAgent(args: {
	ref: string;
	parentId?: string;
	orchestratorName?: string;
	deps: LiveAgentDeps;
}): AgentInfo {
	const name = liveAgentName(args.ref);
	if (!name) throw new Error(`Invalid live-agent ref "${args.ref}". Use agent:<registered-name>.`);
	const agent = args.deps.findAgent(name);
	if (!agent) throw new Error(`Live agent "${name}" is not registered. Available live agents: ${availableNames(args.deps, args.orchestratorName)}.`);
	if (args.parentId && agent.id === args.parentId) throw new Error(`Live agent "${name}" resolves to this orchestrator; choose a peer agent.`);
	if (!agent.alive) throw new Error(`Live agent "${name}" is terminated. Available live agents: ${availableNames(args.deps, args.orchestratorName)}.`);
	if (agent.status === "blocked" || agent.status === "stalled") throw new Error(`Live agent "${name}" is ${agent.status}; choose an available peer.`);
	if (agent.status !== "running" && agent.status !== "waiting") throw new Error(`Live agent "${name}" is ${agent.status}; choose an available peer.`);
	return agent;
}

function requestMessage(request: LiveAgentRequest): string {
	return [
		`TEAM_NODE_REQUEST ${request.id}`,
		"",
		`Role: ${request.role}`,
		`Label: ${request.label}`,
		"",
		"Reply with exactly one agent_send message back to the requester.",
		"The reply body must begin with:",
		`${RESPONSE_PREFIX} ${request.id}`,
		"Then include the final node output after a blank line.",
		"",
		"<system-prompt>",
		request.systemPrompt,
		"</system-prompt>",
		"",
		"<prompt>",
		request.prompt,
		"</prompt>",
	].join("\n");
}

function isProtocolResponse(message: InboundMessage): boolean {
	return message.text.startsWith(`${RESPONSE_PREFIX} `);
}

function responseText(message: InboundMessage, agent: AgentInfo, requestId: string): string | undefined {
	if (message.from.toLowerCase() !== agent.name.toLowerCase()) return undefined;
	const prefix = `${RESPONSE_PREFIX} ${requestId}`;
	if (!message.text.startsWith(prefix)) return undefined;
	return message.text.slice(prefix.length).trim();
}

function isStaleProtocolResponse(message: InboundMessage, now = Date.now()): boolean {
	return isProtocolResponse(message) && now - message.ts > STALE_RESPONSE_MS;
}

function waitForPoll(signal: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve(false);
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve(true);
		}, POLL_INTERVAL_MS);
		const abort = () => {
			clearTimeout(timer);
			resolve(false);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

async function waitForResponse(args: {
	agent: AgentInfo;
	requestId: string;
	parentId: string;
	signal: AbortSignal;
	transport: MessageTransport;
}): Promise<string | undefined> {
	while (!args.signal.aborted) {
		let matched: string | undefined;
		for (const message of receiveRuntimeAgentMessages(args.transport, args.parentId)) {
			const output = responseText(message, args.agent, args.requestId);
			if (output !== undefined) {
				ackRuntimeAgentMessage(args.transport, args.parentId, message.id);
				matched = output;
				continue;
			}
			if (isStaleProtocolResponse(message)) ackRuntimeAgentMessage(args.transport, args.parentId, message.id);
		}
		if (matched !== undefined) return matched;
		if (!await waitForPoll(args.signal)) return undefined;
	}
	return undefined;
}

export async function runLiveAgentNode(args: RunLiveAgentNodeArgs, deps: LiveAgentDeps = defaultDeps()): Promise<ModelRun> {
	const startedAt = Date.now();
	const parentId = args.parentId;
	if (!parentId) {
		return failedRun(args, "live-agent nodes require this orchestrator to be registered in Panopticon", startedAt);
	}
	const agent = assertAvailableAgent({ ref: args.binding.subagent, parentId, orchestratorName: args.orchestratorName, deps });
	deps.runtime?.registerEntity({
		id: agent.id,
		kind: "agent",
		label: agent.name,
		status: "running",
		...(args.runtimeParent ? { parent: args.runtimeParent } : {}),
	});
	const requestId = deps.requestId();
	const from = args.orchestratorName ?? "pi-teams";
	const accepted = await sendRuntimeAgentMessage(deps.transport, {
		agent: {
			id: agent.id,
			name: agent.name,
			pid: agent.pid,
			cwd: "",
			model: agent.model,
			startedAt: 0,
			heartbeat: Date.now() - agent.heartbeatAge,
			status: "running",
		},
		from,
		message: requestMessage({
			id: requestId,
			role: args.binding.role,
			label: args.binding.label ?? args.binding.role,
			systemPrompt: args.systemPrompt,
			prompt: args.prompt,
			orchestratorName: from,
		}),
		parent: args.runtimeParent,
		runtime: deps.runtime,
	});
	if (!accepted.accepted) return failedRun(args, accepted.error ?? "live-agent message was not accepted", startedAt, agent);
	const output = await waitForResponse({ agent, requestId, parentId, signal: args.signal, transport: deps.transport });
	if (output === undefined) return failedRun(args, "cancelled", startedAt, agent);
	return {
		member: { label: args.binding.label ?? args.binding.role, model: agent.model, agentName: agent.name, agentId: agent.id },
		prompt: args.prompt,
		systemPrompt: args.systemPrompt,
		output,
		durationMs: Date.now() - startedAt,
		ok: true,
	};
}

function failedRun(args: RunLiveAgentNodeArgs, error: string, startedAt: number, agent?: AgentInfo): ModelRun {
	return {
		member: {
			label: args.binding.label ?? args.binding.role,
			model: agent?.model ?? args.model,
			...(agent ? { agentName: agent.name, agentId: agent.id } : {}),
		},
		prompt: args.prompt,
		systemPrompt: args.systemPrompt,
		output: "",
		durationMs: Date.now() - startedAt,
		ok: false,
		error,
	};
}

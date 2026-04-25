/**
 * agent_peek tool for pi-panopticon extension.
 *
 * Lists all agents or reads the activity log of a specific agent.
 * No lifecycle management — just the tool definition and execution.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readSessionLog, formatSessionLog } from "../../lib/session-log.js";
import { ok } from "./types.js";
import type { Registry } from "./types.js";
import { formatAge, STATUS_SYMBOL } from "./registry.js";
import { visibleRecords } from "./visibility.js";

// ── Setup ───────────────────────────────────────────────────────

export function setupPeek(
	pi: ExtensionAPI,
	registry: Registry,
): void {
	pi.registerTool({
		name: "agent_peek",
		label: "Agent Peek",
		description:
			"List agents discovered in the shared registry, or read the activity log of a specific agent. " +
			"With no target: returns all registered agents and their status. " +
			"With a target (agent name): reads the agent's activity log.",
		promptSnippet:
			"Discover agents or read a specific agent's activity log",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({
					description: "Agent name to inspect. Omit to list all agents.",
				}),
			),
			lines: Type.Optional(
				Type.Number({
					description: "Number of events to read (default 50)",
					default: 50,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const self = registry.getRecord();
			const records = visibleRecords(self, registry.readAllPeers());
			const selfId = registry.selfId;

			if (!params.target) {
				if (records.length === 0)
					return ok("No agents registered.", { agents: [] });

				const listing = records.map((r) =>
					`  ${STATUS_SYMBOL[r.status]} ${r.name.padEnd(20)} ${r.status.padEnd(10)} ${r.model || "?"} up=${formatAge(r.startedAt)}${
						(r.pendingMessages ?? 0) > 0
							? ` ✉${r.pendingMessages}`
							: ""
					}${r.id === selfId ? " (you)" : ""}${
						r.task ? `  "${r.task.slice(0, 50)}"` : ""
					}`,
				);

				return ok(
					`${records.length} registered agent(s):\n${listing.join("\n")}\n\nUse agent_peek with an agent name to read their activity.\nUse agent_send to message a peer.`,
					{
						agents: records.map((r) => ({
							name: r.name,
							pid: r.pid,
							cwd: r.cwd,
							status: r.status,
							model: r.model,
							task: r.task,
							isSelf: r.id === selfId,
							pendingMessages: r.pendingMessages,
							parentId: r.parentId,
							visibility: r.visibility ?? "global",
						})),
					},
				);
			}

			// Resolve target by name
			const lower = params.target.replace(/^@/, "").toLowerCase();
			const peer = records.find(
				(r) => r.name.toLowerCase() === lower && r.id !== selfId,
			);
			if (!peer) {
				const names = records
					.filter((r) => r.id !== selfId)
					.map((r) => r.name);
				return ok(
					`No agent named "${params.target}". Known peers: ${
						names.length ? names.join(", ") : "(none)"
					}`,
				);
			}

			// Use session JSONL
			if (!peer.sessionFile) {
				return ok(
					`Agent "${params.target}" has no session log yet.`,
					{
						target: peer.name,
						hasSessionFile: false,
					},
				);
			}

			const sessionEvents = readSessionLog(
				peer.sessionFile,
				params.lines ?? 50,
			);
			return ok(
				`Agent "${peer.name}" activity (last ${sessionEvents.length} events):\n\n${formatSessionLog(sessionEvents)}`,
				{
					target: peer.name,
					transport: "session",
					events: sessionEvents.length,
				},
			);
		},
	});
}

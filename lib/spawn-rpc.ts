/**
 * Spawn RPC — JSON command/response over a SpawnedAgent's stdin/stdout.
 *
 * - rpcWrite: fire-and-forget; the agent processes async.
 * - rpcCall:  request/response, optionally waiting for agent_end.
 *
 * The protocol matches `pi --mode rpc`: caller writes a JSON command
 * (`{"type": "prompt"|"steer"|"abort"|"get_state"|...}`); the agent emits a
 * matching `{"type": "response", "command": "<type>", ...}` event on stdout.
 */

import type { SpawnedAgent } from "./spawn-service.js";

/** Write a JSON command to an agent's stdin. Returns false on failure. */
export function rpcWrite(
	agent: SpawnedAgent,
	cmd: Record<string, unknown>,
): boolean {
	if (agent.done || !agent.proc.stdin?.writable) return false;
	try {
		agent.proc.stdin.write(`${JSON.stringify(cmd)}\n`, (err) => {
			if (err) {
				agent.done = true;
				agent.recentEvents.push(`[stdin write error: ${err.message}]`);
			}
		});
		return true;
	} catch (err) {
		agent.done = true;
		agent.recentEvents.push(`[stdin write error: ${err}]`);
		return false;
	}
}

/**
 * Send an RPC command and resolve when a matching "response" event arrives
 * (or "agent_end" when waitForAgent=true).
 */
export function rpcCall(
	agent: SpawnedAgent,
	cmd: Record<string, unknown>,
	opts: { waitForAgent?: boolean; timeoutMs?: number } = {},
): Promise<{ response: Record<string, unknown> | null; events: string[] }> {
	const { waitForAgent = false, timeoutMs = 30_000 } = opts;
	return new Promise((resolve) => {
		const eventsBefore = agent.recentEvents.length;
		if (!rpcWrite(agent, cmd)) {
			resolve({ response: null, events: [] });
			return;
		}

		let response: Record<string, unknown> | null = null;
		let finished = false;

		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			agent.emitter.off("line", onLine);
			resolve({ response, events: agent.recentEvents.slice(eventsBefore) });
		};

		const onLine = (line: string) => {
			if (agent.done) {
				finish();
				return;
			}
			try {
				const evt = JSON.parse(line) as Record<string, unknown>;
				if (evt.type === "response" && evt.command === cmd.type) {
					response = evt;
					if (!waitForAgent) {
						finish();
						return;
					}
				}
				if (waitForAgent && evt.type === "agent_end") {
					finish();
					return;
				}
			} catch {
				/* not JSON */
			}
		};

		const timer = setTimeout(finish, timeoutMs);
		agent.emitter.on("line", onLine);
		if (agent.done) finish();
	});
}

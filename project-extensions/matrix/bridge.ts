/**
 * Matrix extension — inbound bridge.
 *
 * Translates a decrypted Matrix m.room.message into a delivery on the
 * Chief of Staff's panopticon inbox via lib/agent-api.sendAgentMessage.
 *
 * The Chief of Staff's `messaging.drainInbox` then surfaces it to the
 * agent's prompt as `[from matrix:jim]: <text>`, indistinguishable from
 * any other agent_send delivery.
 *
 * If the target agent isn't running, the bridge returns a "no agent"
 * status so the caller (index.ts) can post a friendly reply in the room.
 */

import { findAgentByName, sendAgentMessage } from "../../lib/agent-api.js";
import type { InboundMessage } from "./client.js";

type BridgeOutcome =
	| { kind: "delivered"; agentId: string; from: string }
	| { kind: "no-agent"; targetAgent: string }
	| { kind: "failed"; error: string };

/**
 * Strip the leading `@` and the homeserver suffix from an MXID, leaving
 * just the localpart for use as the `from` label.
 *
 *   `@jim:matrix.org`              → `jim`
 *   `@jim.smith:coas.tail.ts.net`  → `jim.smith`
 */
export function mxidLocalpart(mxid: string): string {
	const noAt = mxid.startsWith("@") ? mxid.slice(1) : mxid;
	const colon = noAt.indexOf(":");
	return colon === -1 ? noAt : noAt.slice(0, colon);
}

/**
 * Bridge a single inbound message to the target agent's inbox.
 * Pure of side effects beyond the sendAgentMessage call — no logging,
 * no UI side effects (those happen in index.ts based on the outcome).
 */
export async function bridgeInbound(
	msg: InboundMessage,
	targetAgent: string,
): Promise<BridgeOutcome> {
	const target = findAgentByName(targetAgent);
	if (!target?.alive) {
		return { kind: "no-agent", targetAgent };
	}

	const from = `matrix:${mxidLocalpart(msg.senderMxid)}`;
	try {
		const accepted = await sendAgentMessage(target.id, from, msg.body);
		if (!accepted) {
			return { kind: "failed", error: "transport rejected the message" };
		}
		return { kind: "delivered", agentId: target.id, from };
	} catch (err) {
		return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
	}
}

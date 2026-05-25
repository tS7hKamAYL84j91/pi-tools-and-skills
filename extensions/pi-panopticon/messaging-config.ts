/**
 * Shared configuration type for Messaging.
 */
import type { MessageTransport } from "../../lib/message-transport.js";

export interface MessagingConfig {
	/** Transport for point-to-point sends (agent_send, /send). */
	send: MessageTransport;
	/** Transport for broadcast (agent_broadcast). */
	broadcast: MessageTransport;
	/** Called for each inbound agent-channel message (e.g. completion-signal parsing). */
	onMessage?: (text: string) => void;
}

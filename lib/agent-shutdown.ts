/** Optional peer-channel shutdown barrier; independent of worker ownership. */

export const BEFORE_AGENT_CHANNEL_SHUTDOWN = "pi-agent-hub:before-channel-shutdown";

/** Listeners synchronously register work that must finish before transport teardown. */
export interface AgentChannelShutdown {
	waitUntil(pending: Promise<void>): void;
}

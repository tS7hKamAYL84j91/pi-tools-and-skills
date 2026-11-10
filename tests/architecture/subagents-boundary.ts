/** Subagent process ownership is independent of peer messaging. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

describe("Subagents boundary", () => {
	it("neither extension imports the other's private implementation", () => {
		for (const [owner, other] of [["pi-agent-hub", "pi-subagents"], ["pi-subagents", "pi-agent-hub"]]) {
			for (const file of listTsFiles(`extensions/${owner}`)) {
				expect(readFileSync(file, "utf8")).not.toMatch(new RegExp(`(?:from\\s*|import\\s*\\()?["'][^"']*${other}/`));
			}
		}
	});

	it("Agent Hub does not own child spawning or RPC tool registration", () => {
		for (const file of listTsFiles("extensions/pi-agent-hub")) {
			expect(readFileSync(file, "utf8")).not.toMatch(/from\s*["']node:child_process["']|name:\s*["'](?:spawn_agent|rpc_send|list_spawned|kill_agent)["']/);
		}
	});

	it("Subagents does not register peer messaging tools or initialize transports", () => {
		for (const file of listTsFiles("extensions/pi-subagents")) {
			expect(readFileSync(file, "utf8")).not.toMatch(/from\s*["'][^"']*(?:message-transport|transports\/|agent-api\.js)|name:\s*["'](?:agent_send|agent_broadcast|message_read|message_send)["']/);
		}
	});
});

import { describe, expect, it } from "vitest";
import { ownPaneIdentity, paneIdentity } from "../../extensions/pi-agent-hub/registry/zellij-pane.mjs";

describe("paneIdentity", () => {
	it.each(["0", "17", "terminal_17"])("normalizes %s", (paneId) => {
		expect(paneIdentity("agent session-1.2", paneId)).toEqual({
			sessionName: "agent session-1.2",
			paneId: paneId === "0" ? 0 : 17,
		});
	});

	it.each([undefined, null, 7, "", " session", "-session", "..", "session\n", "a/b", "a".repeat(129)])(
		"rejects invalid session name %j",
		(sessionName) => expect(paneIdentity(sessionName, "1")).toBeUndefined(),
	);

	it.each([undefined, null, 1, "", "-1", "1.5", "1\n", "terminal_", "plugin_2", "../x", "1; rm", "9007199254740992"])(
		"rejects invalid pane id %j",
		(paneId) => expect(paneIdentity("session", paneId)).toBeUndefined(),
	);

	it("accepts the session length and safe integer boundaries", () => {
		expect(paneIdentity("a".repeat(128), String(Number.MAX_SAFE_INTEGER))).toEqual({
			sessionName: "a".repeat(128),
			paneId: Number.MAX_SAFE_INTEGER,
		});
	});
});

describe("ownPaneIdentity", () => {
	const input = {
		inside: "0",
		sessionName: "session",
		paneId: "terminal_2",
		interactive: true,
	};

	it("advertises only a valid interactive root terminal", () => {
		expect(ownPaneIdentity(input)).toEqual({ sessionName: "session", paneId: 2 });
		expect(ownPaneIdentity({ ...input, paneId: "invalid" })).toBeUndefined();
	});

	it.each([
		{ inside: undefined },
		{ inside: "" },
		{ inside: true },
		{ interactive: false },
		{ parentId: "parent-agent" },
	])("does not advertise an absent or inherited terminal: %j", (override) => {
		expect(ownPaneIdentity({ ...input, ...override })).toBeUndefined();
	});
});

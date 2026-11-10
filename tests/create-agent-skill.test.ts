import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve("skills/create-agent");
const content = readFileSync(resolve(dir, "SKILL.md"), "utf8");

describe("create-agent skill", () => {
	it("loads through Pi without diagnostics", () => {
		const result = loadSkillsFromDir({ dir, source: "test" });
		expect(result.diagnostics).toEqual([]);
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]).toMatchObject({
			name: "create-agent",
			baseDir: dir,
			disableModelInvocation: false,
		});
		expect(result.skills[0]?.description).toContain("standing");
	});

	it("documents the actual sidebar tools and safety receipts", () => {
		const adapter = readFileSync("agent-hub-pane/pi-agents-pane-mcp.mjs", "utf8");
		for (const tool of ["hub_list_agents", "hub_create_agent", "hub_close_agent", "hub_set_lead"]) {
			expect(content).toContain(tool);
			expect(adapter).toContain(`registerTool("${tool}"`);
		}
		for (const boundary of ["instance_id", "request_id", "not_yet_verified", "confirmation_required", "Never inject confirmation keystrokes", "Never retry a possibly dispatched creation with a new ID"]) {
			expect(content).toContain(boundary);
		}
		expect(readFileSync(resolve(dir, "../../agent-hub-pane/README.md"), "utf8"))
			.toContain("## Tab-scoped MCP (opt-in)");
	});
});

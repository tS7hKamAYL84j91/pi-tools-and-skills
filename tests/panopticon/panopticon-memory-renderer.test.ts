import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderSyntheticPanopticonMemory } from "../../extensions/pi-panopticon/ui/memory-renderer.js";

const fixtureDir = join(process.cwd(), "tests", "fixtures", "panopticon-memory");

function syntheticFixture(): unknown {
	return JSON.parse(readFileSync(join(fixtureDir, "synthetic-agent.json"), "utf8"));
}

describe("synthetic Panopticon MEMORY.md renderer", () => {
	it("renders deterministic MEMORY.md-shaped output from a synthetic fixture", () => {
		const expected = readFileSync(join(fixtureDir, "expected-memory.md"), "utf8");

		expect(renderSyntheticPanopticonMemory(syntheticFixture() as never)).toBe(expected);
	});

	it("redacts credential-shaped text and records redaction count", () => {
		const fixture = syntheticFixture() as {
			currentState: string;
			activity: string[];
		};
		fixture.currentState = `Investigating ${["api", "key"].join("_")}=synthetic-value`;
		fixture.activity = [`${["Authorization", "Bearer"].join(": ")} ${["synthetic", "token"].join("-")}`];

		const rendered = renderSyntheticPanopticonMemory(fixture as never);

		expect(rendered).toContain("api_key=[REDACTED]");
		expect(rendered).toContain("Authorization=[REDACTED]");
		expect(rendered).toContain("redactionCount: 2");
		expect(rendered).not.toContain("synthetic-value");
		expect(rendered).not.toContain("synthetic-token");
	});

	it("caps activity bullets and total rendered bytes", () => {
		const fixture = syntheticFixture() as { activity: string[] };
		fixture.activity = Array.from({ length: 5 }, (_value, index) => `activity ${index + 1}`);

		const rendered = renderSyntheticPanopticonMemory(fixture as never, { maxActivityBullets: 2, maxBytes: 1_000 });

		expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(1_000);
		expect(rendered).toContain("activity 1");
		expect(rendered).toContain("activity 2");
		expect(rendered).not.toContain("activity 3");
		expect(rendered).toContain("Snapshot truncated to size cap");
	});

	it("rejects non-synthetic redaction policy and unsupported fixture schema", () => {
		const fixture = syntheticFixture() as { redaction: { policy: string }; schemaVersion: number };
		fixture.redaction.policy = "local-private";
		expect(() => renderSyntheticPanopticonMemory(fixture as never)).toThrow(/synthetic redaction policy/);
		fixture.redaction.policy = "synthetic";
		fixture.schemaVersion = 2;
		expect(() => renderSyntheticPanopticonMemory(fixture as never)).toThrow(/schemaVersion/);
	});
});

/** Tests for operator-issued diagnostic command outcome correlation (SPEC §7, §16). */

import { describe, expect, it } from "vitest";
import { CONFIG } from "../../../tests/fixtures/pi-event-loop.js";
import { type EmissionContext, evaluateEmission } from "../event-ingress.js";
import { issueDiagnostic } from "../event-loop-issue.js";
import { createEventLoopRuntime } from "../runtime.js";

function context(overrides: Partial<EmissionContext> = {}): EmissionContext {
	return {
		config: CONFIG,
		profileName: "default",
		source: "agent",
		activeCommand: undefined,
		activeWorkItem: undefined,
		knownEventIds: new Set<string>(),
		now: () => "2026-09-04T15:00:00Z",
		...overrides,
	};
}

describe("diagnostic issue outcome correlation", () => {
	it("accepts a valid expected outcome for an operator-issued diagnostic command despite synthetic view", () => {
		const runtime = createEventLoopRuntime();
		const issueResult = issueDiagnostic(
			["perform-work", JSON.stringify({ workId: "work-42" })],
			CONFIG,
			runtime,
		);
		expect(issueResult.isError).toBeUndefined();
		const command = runtime.queue[0];
		expect(command).toBeDefined();
		if (!command) return;
		const item = runtime.projection.items.get(command.workItemId);
		expect(item).toBeDefined();
		if (!item) return;
		expect(item.viewId).toBe("operator-issue");

		const active = context({
			activeCommand: command,
			activeWorkItem: item,
		});
		const decision = evaluateEmission(active, {
			event: "work.completed",
			dedupeKey: "diag-done-1",
			payload: { workId: "work-42", resultPath: "out/diag.json" },
		});
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(decision.event.commandId).toBe(command.commandId);
			expect(decision.event.workItemId).toBe(item.workItemId);
		}
	});

	it("rejects an expected outcome for diagnostic command when correlation key mismatches work item payload", () => {
		const runtime = createEventLoopRuntime();
		issueDiagnostic(
			["perform-work", JSON.stringify({ workId: "work-42" })],
			CONFIG,
			runtime,
		);
		const command = runtime.queue[0];
		expect(command).toBeDefined();
		if (!command) return;
		const item = runtime.projection.items.get(command.workItemId);
		expect(item).toBeDefined();
		if (!item) return;
		const active = context({
			activeCommand: command,
			activeWorkItem: item,
		});
		const decision = evaluateEmission(active, {
			event: "work.completed",
			dedupeKey: "diag-done-2",
			payload: { workId: "work-99", resultPath: "out/diag.json" },
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain("correlation key mismatch");
		}
	});
});

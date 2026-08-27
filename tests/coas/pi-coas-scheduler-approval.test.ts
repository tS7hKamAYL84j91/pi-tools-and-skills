import { describe, expect, it } from "vitest";
import { requiresPrincipalApproval } from "../../extensions/pi-coas/scheduler-approval.js";
import type { ScheduleEntry } from "../../extensions/pi-coas/types.js";

function makeSchedule(prompt: string, approvalRequired = false): ScheduleEntry {
	return {
		taskId: "test",
		taskName: "test",
		roomId: "general",
		workspaceId: "test",
		cronExpr: "0 9 * * 1",
		enabled: true,
		promptFile: "/tmp/test.prompt",
		approvalRequired,
		prompt,
	};
}

describe("requiresPrincipalApproval", () => {
	it("requires approval when the schedule is explicitly approval-gated", () => {
		expect(requiresPrincipalApproval(makeSchedule("Do work.", true), "Do work.")).toBe(true);
	});

	it("does not require approval for a benign prompt", () => {
		expect(requiresPrincipalApproval(makeSchedule("Do work."), "Do work.")).toBe(false);
	});

	it("does not require approval for read-only monitoring prompts", () => {
		const monitorTickets =
			"Ticket monitoring + auto-promotion cadence. Read-only on work: no mutating ticket content, code, or commits. Use agent_send to Lumen-Pending with a one-line summary.";
		expect(requiresPrincipalApproval(makeSchedule(monitorTickets), monitorTickets)).toBe(false);

		const repoWatch =
			"Weekly repo-watch: monitor repos. For each source: check commits/releases/blog posts since last cycle. Use git log / commit deltas / RSS where possible.";
		expect(requiresPrincipalApproval(makeSchedule(repoWatch), repoWatch)).toBe(false);
	});

	it("requires approval for literal git push/commit/merge commands", () => {
		expect(requiresPrincipalApproval(makeSchedule("Run git commit -m update"), "Run git commit -m update")).toBe(true);
		expect(requiresPrincipalApproval(makeSchedule("git push origin main"), "git push origin main")).toBe(true);
		expect(requiresPrincipalApproval(makeSchedule("git merge feature"), "git merge feature")).toBe(true);
	});

	it("does not require approval for isolated mentions of commit/push/merge", () => {
		expect(requiresPrincipalApproval(makeSchedule("Inspect commit deltas and git log"), "Inspect commit deltas and git log")).toBe(false);
		expect(requiresPrincipalApproval(makeSchedule("Push notifications are read-only"), "Push notifications are read-only")).toBe(false);
		expect(requiresPrincipalApproval(makeSchedule("Merge requests are read-only"), "Merge requests are read-only")).toBe(false);
	});

	it("requires approval for send and secret actions", () => {
		expect(requiresPrincipalApproval(makeSchedule("Send an email to the team"), "Send an email to the team")).toBe(true);
		expect(requiresPrincipalApproval(makeSchedule("Read the secret token"), "Read the secret token")).toBe(true);
		expect(requiresPrincipalApproval(makeSchedule("Repository mutation required"), "Repository mutation required")).toBe(true);
	});
});

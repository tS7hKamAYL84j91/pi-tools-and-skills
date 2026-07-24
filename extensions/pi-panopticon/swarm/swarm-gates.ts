/** Evidence-first artifact checks and bounded stacked review dispatch. */

import type {
	SwarmArtifact,
	SwarmGateResult,
	SwarmReviewAdapter,
	SwarmTask,
} from "./swarm-types.js";

const REVIEW_TEAMS = {
	navigator: ["navigator"],
	architecture: ["navigator", "llm-council"],
	stacked: ["navigator", "llm-council", "fire-review"],
} as const;

function validArtifact(artifact: SwarmArtifact): boolean {
	const hasLocator = Boolean(artifact.path?.trim() || artifact.command?.trim());
	return hasLocator && artifact.evidence.trim().length > 0;
}

function renderPrompt(task: SwarmTask): string {
	const evidence = task.artifacts
		.map((artifact) => `${artifact.path ?? artifact.command}: ${artifact.evidence}`)
		.join("\n");
	return `Review task ${task.id}: ${task.title}\nArtifact evidence:\n${evidence}\nReturn pass, revise, or blocked.`;
}

/** Rejects prose-only completion and runs the task's configured review stack. */
export async function runSwarmGates(
	task: SwarmTask,
	adapter: SwarmReviewAdapter,
): Promise<SwarmGateResult> {
	if (task.artifacts.length === 0 || !task.artifacts.every(validArtifact)) {
		return {
			verdict: "blocked",
			reason: "DONE requires artifacts with a path or command and checkable evidence.",
			reviews: [],
		};
	}
	const reviews = [];
	for (const teamId of REVIEW_TEAMS[task.reviewProfile]) {
		const review = await adapter.review(teamId, renderPrompt(task));
		reviews.push(review);
		if (review.verdict !== "pass") {
			return { verdict: review.verdict, reason: review.summary, reviews };
		}
	}
	return { verdict: "pass", reason: "Artifact and review gates passed.", reviews };
}

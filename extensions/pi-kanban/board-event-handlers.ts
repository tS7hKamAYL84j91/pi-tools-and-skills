/**
 * Pure event-application helpers for the pi-kanban board replay.
 */
import type { KanbanEvent } from "./board-events.js";

export interface TaskState {
	id: string;
	col: string;
	deleted: boolean;
	title: string;
	priority: string;
	tags: string;
	description: string;
	agent: string;
	claimed: boolean;
	claimAgent: string;
	model: string;
	expires: string;
	reason: string;
	discoveredFrom: string;
	notes: string[];
	completedAt: string;
	duration: string;
	doneAgent: string;
	verificationRequired: boolean;
	checks: TaskVerificationCheck[];
	createdAt: string;
}

export interface TaskVerificationCheck {
	readonly command: string;
	readonly result: string;
	readonly exitCode: number;
}

/** Apply one typed event to a task accumulator. */
export function applyEvent(task: TaskState, event: KanbanEvent): void {
	switch (event.type) {
		case "create":
			if (event.title) task.title = event.title;
			if (event.priority) task.priority = event.priority;
			if (event.tags) task.tags = event.tags;
			if (event.description) task.description = event.description;
			if (event.discovered_from) task.discoveredFrom = event.discovered_from;
			task.createdAt = event.ts;
			task.agent = event.agent;
			break;
		case "move":
			task.col = event.to;
			break;
		case "claim":
			if (!task.claimed) {
				task.claimed = true;
				task.claimAgent = event.agent;
				task.col = "in-progress";
				if (event.expires) task.expires = event.expires;
				if (event.model) task.model = event.model;
			}
			break;
		case "unclaim":
		case "expire":
			task.claimed = false;
			task.claimAgent = "";
			task.expires = "";
			break;
		case "complete":
			task.claimed = false;
			task.claimAgent = "";
			task.expires = "";
			task.completedAt = event.ts;
			task.col = "done";
			if (event.duration) task.duration = event.duration;
			task.doneAgent = event.agent;
			if (event.verification_required === true) task.verificationRequired = true;
			if (event.checks) {
				task.checks = event.checks.map((check) => ({
					command: check.command,
					result: check.result,
					exitCode: check.exit_code,
				}));
			}
			break;
		case "block":
			task.claimed = false;
			task.claimAgent = "";
			task.col = "blocked";
			if (event.reason) task.reason = event.reason;
			break;
		case "unblock":
			task.reason = "";
			task.col = "todo";
			break;
		case "note":
			task.notes.push(`${event.ts} [${event.agent}] ${event.text}`);
			break;
		case "delete":
			task.deleted = true;
			break;
		case "edit":
			if (event.title) task.title = event.title;
			if (event.priority) task.priority = event.priority;
			if (event.tags) task.tags = event.tags;
			if (event.description) task.description = event.description;
			break;
	}
}

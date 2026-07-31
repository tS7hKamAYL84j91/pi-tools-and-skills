/**
 * Read-only kanban JSON export helpers.
 */
import type { BoardState, TaskState } from "./board.js";

interface KanbanExportTask {
	id: string;
	column: string;
	priority: string;
	title: string;
	tags: string[];
	agent?: string;
	model?: string;
	blockedReason?: string;
	createdAt?: string;
	completedAt?: string;
	verificationRequired?: boolean;
	checks?: { command: string; result: string; exit_code: number }[];
}

interface KanbanExport {
	schemaVersion: 1;
	totalEvents: number;
	counts: Record<string, number>;
	tasks: KanbanExportTask[];
}

function tags(value: string): string[] {
	return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function exportTask(task: TaskState): KanbanExportTask {
	const agent = task.claimAgent || task.doneAgent || task.agent;
	const result: KanbanExportTask = {
		id: task.id,
		column: task.col,
		priority: task.priority,
		title: task.title,
		tags: tags(task.tags),
		...(agent ? { agent } : {}),
		...(task.model ? { model: task.model } : {}),
		...(task.reason ? { blockedReason: task.reason } : {}),
		...(task.createdAt ? { createdAt: task.createdAt } : {}),
		...(task.completedAt ? { completedAt: task.completedAt } : {}),
	};
	if (task.verificationRequired || task.checks.length > 0) {
		result.verificationRequired = task.verificationRequired;
		result.checks = task.checks.map((c) => ({
			command: c.command,
			result: c.result,
			exit_code: c.exitCode,
		}));
	}
	return result;
}

/** Build a stable, read-only JSON export from reconstructed board state. */
export function exportBoardJson(board: BoardState): KanbanExport {
	const tasks = board.order
		.map((id) => board.tasks.get(id))
		.filter((task): task is TaskState => task !== undefined && !task.deleted)
		.map(exportTask);
	const counts: Record<string, number> = {};
	for (const task of tasks) counts[task.column] = (counts[task.column] ?? 0) + 1;
	return { schemaVersion: 1, totalEvents: board.totalEvents, counts, tasks };
}

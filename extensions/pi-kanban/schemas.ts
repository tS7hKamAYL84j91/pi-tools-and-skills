/**
 * Shared Kanban tool parameter schemas.
 */

import { Type } from "@sinclair/typebox";

export const TASK_ID_SCHEMA = Type.String({
	description: "Task ID in T-NNN format",
});

export const CHECK_ITEM_SCHEMA = Type.Object({
	command: Type.String({
		description: "Command that was run to verify this acceptance criterion (reported, not executed).",
	}),
	result: Type.String({
		description: "Short summary of the command output or observation.",
	}),
	exit_code: Type.Number({
		description: "Exit code from the command; 0 means success.",
	}),
});

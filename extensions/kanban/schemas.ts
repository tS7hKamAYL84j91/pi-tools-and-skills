/**
 * Shared Kanban tool parameter schemas.
 */

import { Type } from "@sinclair/typebox";

export const TASK_ID_SCHEMA = Type.String({ description: "Task ID in T-NNN format" });

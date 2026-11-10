/**
 * Spawner scope constants.
 *
 * Kept in the spawner module rather than lib/ to avoid unnecessary
 * cross-module coupling; only the spawner and scheduler consume this value.
 */

export type AgentScope = "workspace" | "task";

/** Env var read by spawned agents to declare their schedule-delivery scope. */
export const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

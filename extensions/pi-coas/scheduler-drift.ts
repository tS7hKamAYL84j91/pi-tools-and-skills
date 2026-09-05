/** Model drift guard for the pi-coas pi-scheduler (fail closed on drift). */

const MAX_ALERT_CHARS = 400;

/**
 * Returns a drift reason when the snapshotted model no longer matches the
 * active session model, or undefined when the guard is inert. The guard is
 * inert when either side is unknown: an undeterminable model must not brick
 * schedules, and schedules without a snapshot never opted into the guard.
 */
export function modelDriftReason(modelSnapshot: string | undefined, currentModel: string | undefined): string | undefined {
	if (!modelSnapshot || !currentModel) return undefined;
	if (modelSnapshot === currentModel) return undefined;
	return `model_drift: expected=${modelSnapshot} current=${currentModel}`;
}

/** Bounded, non-secret alert text delivered when a run is skipped for drift. */
export function renderDriftAlert(taskId: string, reason: string): string {
	const alert = `CoAS model drift: schedule "${taskId}" was skipped (${reason}). The session model no longer matches the model snapshotted at schedule creation. Resolve by switching the session back to that model, or re-create the schedule to re-snapshot.`;
	return alert.slice(0, MAX_ALERT_CHARS);
}
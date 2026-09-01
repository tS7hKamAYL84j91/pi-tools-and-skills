/**
 * Published daemon registry protocol types (ADR-053): the registry view
 * (entries, atomic snapshots) and monotonically sequenced change events the
 * daemon exposes over the M6 sync wire (design doc section 7). The registry
 * implementation stays private in daemon/src/registry.ts.
 */
import type { AdmissionScope } from "./admission.js";

export type RegistryEventKind =
	| "identity_created"
	| "instance_admitted"
	| "instance_invalidated";

export type InvalidationReason =
	| "superseded"
	| "crashed"
	| "restart_stale"
	| "close_drain_expired";

export interface RegistryEvent {
	readonly seq: number;
	readonly at: string;
	readonly kind: RegistryEventKind;
	readonly agentId: string;
	readonly instanceId?: string;
	readonly generation?: number;
	readonly reason?: InvalidationReason;
}

export interface RegistryEntry {
	readonly agentId: string;
	readonly displayName: string;
	readonly generation: number;
	readonly liveInstanceId?: string;
	readonly parentId: string | null;
	readonly visibility: string;
	readonly scope: AdmissionScope;
	/** Identity creation time (feeds the view model's startedAt). */
	readonly createdAt: string;
}

export interface RegistrySnapshot {
	/** Sequence of the last event contained in this snapshot. */
	readonly seq: number;
	readonly generatedAt: string;
	readonly entries: readonly RegistryEntry[];
}

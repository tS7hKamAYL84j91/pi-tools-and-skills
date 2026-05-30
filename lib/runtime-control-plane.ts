/** Narrow Panopticon runtime entity control-plane adapter. */

export type RuntimeEntityKind = "agent" | "team_run" | "child_process";
export type RuntimeEntityStatus = "pending" | "running" | "stopping" | "stopped" | "completed" | "failed";

export interface RuntimeEntityRef {
	readonly id: string;
	readonly kind: RuntimeEntityKind;
}

export interface RuntimeEvent {
	readonly type: string;
	readonly entity: RuntimeEntityRef;
	readonly timestamp: number;
	readonly parent?: RuntimeEntityRef;
	readonly message?: string;
}

export interface RuntimeEntitySnapshot extends RuntimeEntityRef {
	readonly label: string;
	readonly status: RuntimeEntityStatus;
	readonly parent?: RuntimeEntityRef;
	readonly children: RuntimeEntityRef[];
	readonly updatedAt: number;
}

interface RuntimeEntityRecord {
	readonly ref: RuntimeEntityRef;
	readonly label: string;
	status: RuntimeEntityStatus;
	parent?: RuntimeEntityRef;
	readonly children: RuntimeEntityRef[];
	updatedAt: number;
	stop?: (reason: string) => void;
}

export interface RegisterRuntimeEntityRequest extends RuntimeEntityRef {
	readonly label: string;
	readonly status?: RuntimeEntityStatus;
	readonly parent?: RuntimeEntityRef;
	readonly stop?: (reason: string) => void;
}

/**
 * Session-local runtime adapter for entity inspection, stop, events, and lineage.
 *
 * This keeps protocol-specific state in extensions while giving Panopticon-owned
 * code a common substrate shape for agents, team runs, and child processes.
 */
export class RuntimeControlPlane {
	private readonly entities = new Map<string, RuntimeEntityRecord>();
	private readonly events: RuntimeEvent[] = [];

	registerEntity(request: RegisterRuntimeEntityRequest): RuntimeEntityRef {
		const ref: RuntimeEntityRef = { id: request.id, kind: request.kind };
		this.entities.set(key(ref), {
			ref,
			label: request.label,
			status: request.status ?? "pending",
			...(request.parent ? { parent: request.parent } : {}),
			children: [],
			updatedAt: Date.now(),
			...(request.stop ? { stop: request.stop } : {}),
		});
		if (request.parent) this.linkEntities(request.parent, ref);
		this.emitEvent({ type: "runtime.entity.registered", entity: ref, parent: request.parent });
		return ref;
	}

	updateStatus(ref: RuntimeEntityRef, status: RuntimeEntityStatus): boolean {
		const record = this.entities.get(key(ref));
		if (!record) return false;
		record.status = status;
		record.updatedAt = Date.now();
		this.emitEvent({ type: `runtime.entity.${status}`, entity: ref, parent: record.parent });
		return true;
	}

	stopEntity(ref: RuntimeEntityRef, reason: string): boolean {
		const record = this.entities.get(key(ref));
		if (!record) return false;
		record.status = "stopping";
		record.updatedAt = Date.now();
		record.stop?.(reason);
		this.emitEvent({ type: "runtime.entity.stop_requested", entity: ref, parent: record.parent, message: reason });
		return true;
	}

	inspectEntity(ref: RuntimeEntityRef): RuntimeEntitySnapshot | undefined {
		const record = this.entities.get(key(ref));
		return record ? snapshot(record) : undefined;
	}

	listEntities(): RuntimeEntitySnapshot[] {
		return [...this.entities.values()].map(snapshot);
	}

	linkEntities(parent: RuntimeEntityRef, child: RuntimeEntityRef): boolean {
		const parentRecord = this.entities.get(key(parent));
		const childRecord = this.entities.get(key(child));
		if (!parentRecord || !childRecord) return false;
		childRecord.parent = parent;
		childRecord.updatedAt = Date.now();
		if (!parentRecord.children.some((existing) => key(existing) === key(child))) parentRecord.children.push(child);
		parentRecord.updatedAt = Date.now();
		this.emitEvent({ type: "runtime.entity.linked", entity: child, parent });
		return true;
	}

	emitEvent(event: Omit<RuntimeEvent, "timestamp">): RuntimeEvent {
		const full = { ...event, timestamp: Date.now() };
		this.events.push(full);
		return full;
	}

	listEvents(): RuntimeEvent[] {
		return [...this.events];
	}
}

function key(ref: RuntimeEntityRef): string {
	return `${ref.kind}:${ref.id}`;
}

function snapshot(record: RuntimeEntityRecord): RuntimeEntitySnapshot {
	return {
		...record.ref,
		label: record.label,
		status: record.status,
		...(record.parent ? { parent: record.parent } : {}),
		children: [...record.children],
		updatedAt: record.updatedAt,
	};
}

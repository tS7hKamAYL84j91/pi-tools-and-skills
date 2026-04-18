/**
 * Operational workspace state for the current session.
 *
 * Persists narrow control-plane metadata across session reload/resume without
 * storing full transcripts or inventing a generic multi-channel abstraction.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";

const STATE_ENTRY_TYPE = "panopticon-workspace-state";

export type WorkspaceSourceChannel = "local" | "matrix" | "agent";

export interface OperationalWorkspaceState {
	version: 1;
	workspaceId: string;
	sourceChannel: WorkspaceSourceChannel;
	humanIdentity: string;
	lastActiveAt: number;
	linkedPaths: {
		cwd: string;
		sessionFile?: string;
		journalDir?: string;
		kanbanSnapshot?: string;
	};
	pendingFollowUps: string[];
	resume: {
		reason: string;
		previousSessionFile?: string;
	};
}

interface SessionStartLikeEvent {
	reason?: string;
	previousSessionFile?: string;
}

interface InputLikeEvent {
	text?: string;
	source?: "interactive" | "rpc" | "extension" | string;
}

interface WorkspaceIdentity {
	workspaceId: string;
	sourceChannel: WorkspaceSourceChannel;
	humanIdentity: string;
}

function getLinkedPaths(ctx: ExtensionContext): OperationalWorkspaceState["linkedPaths"] {
	const cwd = ctx.cwd;
	const linkedPaths: OperationalWorkspaceState["linkedPaths"] = {
		cwd,
		sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
	};
	const journalDir = join(cwd, "journals");
	if (existsSync(journalDir)) {
		linkedPaths.journalDir = journalDir;
	}
	const kanbanSnapshot = join(cwd, "kanban", "snapshot.md");
	if (existsSync(kanbanSnapshot)) {
		linkedPaths.kanbanSnapshot = kanbanSnapshot;
	}
	return linkedPaths;
}

export function inferWorkspaceIdentity(event: InputLikeEvent): WorkspaceIdentity | null {
	if (event.source === "interactive") {
		return { workspaceId: "local:interactive", sourceChannel: "local", humanIdentity: "interactive" };
	}
	if (event.source === "rpc") {
		return { workspaceId: "local:rpc", sourceChannel: "local", humanIdentity: "rpc" };
	}
	if (event.source !== "extension" || !event.text) {
		return null;
	}

	const match = event.text.match(/^<agent-message from="([^"]+)">/);
	const from = match?.[1]?.trim();
	if (!from) {
		return null;
	}
	if (from.startsWith("matrix:")) {
		const humanIdentity = from.slice("matrix:".length);
		return { workspaceId: `matrix:${humanIdentity}`, sourceChannel: "matrix", humanIdentity };
	}
	return { workspaceId: `agent:${from}`, sourceChannel: "agent", humanIdentity: from };
}

type SessionEntry = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>[number];

function isStateEntry(entry: SessionEntry): entry is SessionEntry & { type: "custom"; customType: typeof STATE_ENTRY_TYPE; data?: OperationalWorkspaceState } {
	return entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE;
}

export function restoreLatestWorkspaceState(entries: SessionEntry[]): OperationalWorkspaceState | undefined {
	let latest: OperationalWorkspaceState | undefined;
	for (const entry of entries) {
		if (!isStateEntry(entry)) {
			continue;
		}
		const data = entry.data;
		if (!data || data.version !== 1) {
			continue;
		}
		latest = data;
	}
	return latest;
}

function createDefaultState(ctx: ExtensionContext, event?: SessionStartLikeEvent): OperationalWorkspaceState {
	return {
		version: 1,
		workspaceId: "local:interactive",
		sourceChannel: "local",
		humanIdentity: "interactive",
		lastActiveAt: Date.now(),
		linkedPaths: getLinkedPaths(ctx),
		pendingFollowUps: [],
		resume: {
			reason: event?.reason ?? "startup",
			previousSessionFile: event?.previousSessionFile,
		},
	};
}

export class OperationalStateStore {
	private state: OperationalWorkspaceState | undefined;
	private lastPersisted = "";

	constructor(private pi: ExtensionAPI) {}

	restore(ctx: ExtensionContext, event?: SessionStartLikeEvent): void {
		const restored = restoreLatestWorkspaceState(ctx.sessionManager.getEntries());
		this.state = restored
			? {
				...restored,
				linkedPaths: getLinkedPaths(ctx),
				resume: {
					reason: event?.reason ?? restored.resume.reason,
					previousSessionFile: event?.previousSessionFile ?? restored.resume.previousSessionFile,
				},
			}
			: createDefaultState(ctx, event);
		this.persist();
	}

	recordInput(ctx: ExtensionContext, event: InputLikeEvent): void {
		if (!this.state) {
			this.state = createDefaultState(ctx);
		}
		const identity = inferWorkspaceIdentity(event);
		if (identity) {
			this.state.workspaceId = identity.workspaceId;
			this.state.sourceChannel = identity.sourceChannel;
			this.state.humanIdentity = identity.humanIdentity;
		}
		this.state.lastActiveAt = Date.now();
		this.state.linkedPaths = getLinkedPaths(ctx);
		this.persist();
	}

	getState(): Readonly<OperationalWorkspaceState> | undefined {
		return this.state;
	}

	private persist(): void {
		if (!this.state) {
			return;
		}
		const serialized = JSON.stringify(this.state);
		if (serialized === this.lastPersisted) {
			return;
		}
		this.pi.appendEntry(STATE_ENTRY_TYPE, this.state);
		this.lastPersisted = serialized;
	}
}

export { STATE_ENTRY_TYPE };

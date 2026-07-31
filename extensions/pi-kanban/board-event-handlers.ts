/**
 * Pure event-application helpers for the pi-kanban board parser.
 */
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

/** Event shape passed to applyEvent. */
interface BoardEvent {
	readonly task: TaskState;
	readonly event: string;
	readonly agent: string;
	readonly timestamp: string;
	readonly payload: Record<string, string>;
}

/** Apply a single event to a task accumulator. */
export function applyEvent(boardEvent: BoardEvent): void {
	const { task, event, agent, timestamp, payload } = boardEvent;
	switch (event) {
		case "CREATE":
			applyCreate(task, agent, timestamp, payload);
			break;
		case "MOVE":
			if (payload.to) task.col = payload.to;
			break;
		case "CLAIM":
			applyClaim(task, agent, payload);
			break;
		case "UNCLAIM":
		case "EXPIRE":
			task.claimed = false;
			task.claimAgent = "";
			task.expires = "";
			break;
		case "COMPLETE":
			applyComplete(task, agent, timestamp, payload);
			break;
		case "BLOCK":
			task.claimed = false;
			task.claimAgent = "";
			task.col = "blocked";
			if (payload.reason) task.reason = payload.reason;
			break;
		case "UNBLOCK":
			task.reason = "";
			task.col = "todo";
			break;
		case "NOTE":
			task.notes.push(`${timestamp} [${agent}] ${payload.text ?? ""}`);
			break;
		case "DELETE":
			task.deleted = true;
			break;
		case "EDIT":
			applyEdit(task, payload);
			break;
	}
}

function applyCreate(
	task: TaskState,
	agent: string,
	timestamp: string,
	payload: Record<string, string>,
): void {
	if (payload.title) task.title = payload.title;
	if (payload.priority) task.priority = payload.priority;
	if (payload.tags) task.tags = payload.tags;
	if (payload.description) task.description = payload.description;
	task.createdAt = timestamp;
	task.agent = agent;
}

function applyClaim(task: TaskState, agent: string, payload: Record<string, string>): void {
	if (!task.claimed) {
		task.claimed = true;
		task.claimAgent = agent;
		task.col = "in-progress";
		if (payload.expires) task.expires = payload.expires;
		if (payload.model) task.model = payload.model;
	}
}

function applyComplete(
	task: TaskState,
	agent: string,
	timestamp: string,
	payload: Record<string, string>,
): void {
	task.claimed = false;
	task.claimAgent = "";
	task.expires = "";
	task.completedAt = timestamp;
	task.col = "done";
	if (payload.duration) task.duration = payload.duration;
	task.doneAgent = agent;
	if (payload.verification_required)
		task.verificationRequired = payload.verification_required === "true";
	if (payload.checks) {
		task.checks = parseChecks(payload.checks);
	}
}

function applyEdit(task: TaskState, payload: Record<string, string>): void {
	if (payload.title) task.title = payload.title;
	if (payload.priority) task.priority = payload.priority;
	if (payload.tags) task.tags = payload.tags;
	if (payload.description) task.description = payload.description;
}

function parseChecks(raw: string): TaskVerificationCheck[] {
	try {
		const unquoted = raw.replace(/'/g, '"');
		const parsed = JSON.parse(unquoted) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
			.map((c) => ({
				command: typeof c.command === "string" ? c.command : "",
				result: typeof c.result === "string" ? c.result : "",
				exitCode: typeof c.exit_code === "number" ? c.exit_code : typeof c.exitCode === "number" ? c.exitCode : -1,
			}))
			.filter((c) => c.command || c.result);
	} catch {
		return [];
	}
}

/** Serialize checks for the event log. */
export function formatChecks(checks: TaskVerificationCheck[]): string {
	return JSON.stringify(
		checks.map((c) => ({ command: c.command, result: c.result, exit_code: c.exitCode })),
	);
}

/** Parse key=value pairs (with quoted values) from log fields. */
export function parseKV(fields: string[]): Record<string, string> {
	const kv: Record<string, string> = {};
	let i = 0;
	while (i < fields.length) {
		const field = fields[i] ?? "";
		const eq = field.indexOf("=");
		if (eq <= 0) {
			i++;
			continue;
		}
		const key = field.slice(0, eq);
		let val = field.slice(eq + 1);
		if (val.startsWith('"')) {
			val = val.slice(1);
			while (!val.endsWith('"') && i + 1 < fields.length) {
				i++;
				val += ` ${fields[i] ?? ""}`;
			}
			if (val.endsWith('"')) val = val.slice(0, -1);
		}
		kv[key] = val;
		i++;
	}
	return kv;
}

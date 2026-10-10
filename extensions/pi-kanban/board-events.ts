/**
 * Typed board events and the JSONL codec for board.events.jsonl.
 *
 * Each line is one versioned, discriminated event. The log is the
 * authoritative board state; `parseBoard` replays these events.
 */
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { EventLogCodec } from "../../lib/event-log.js";
import { TASK_ID_SCHEMA } from "./schemas.js";

/** Current on-disk event version; every line carries it. */
const KANBAN_EVENT_VERSION = 1;

/**
 * Raised when a log line was written by a build that knows a newer event
 * version. Reading on would silently drop events, so the board fails loud.
 */
export class KanbanEventVersionError extends Error {
	constructor(readonly found: number) {
		super(
			`board.events.jsonl holds event version ${found}; this build supports ${KANBAN_EVENT_VERSION}. ` +
				"Refusing to read the log and silently drop events written by a newer build. " +
				"Upgrade the pi-kanban extension or migrate the board before reading it.",
		);
		this.name = "KanbanEventVersionError";
	}
}

function futureVersion(value: unknown): number | null {
	if (typeof value !== "object" || value === null || !("v" in value)) return null;
	const version = (value as { v: unknown }).v;
	return typeof version === "number" && version > KANBAN_EVENT_VERSION
		? version
		: null;
}

const BASE = {
	v: Type.Literal(KANBAN_EVENT_VERSION),
	ts: Type.String(),
	task_id: TASK_ID_SCHEMA,
	agent: Type.String(),
} as const;

const CHECK_ITEM = Type.Object({
	command: Type.String(),
	result: Type.String(),
	exit_code: Type.Number(),
});

const CreateEvent = Type.Object({
	...BASE,
	type: Type.Literal("create"),
	title: Type.Optional(Type.String()),
	priority: Type.Optional(Type.String()),
	tags: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	discovered_from: Type.Optional(TASK_ID_SCHEMA),
});

const MoveEvent = Type.Object({
	...BASE,
	type: Type.Literal("move"),
	from: Type.String(),
	to: Type.String(),
});

const ClaimEvent = Type.Object({
	...BASE,
	type: Type.Literal("claim"),
	model: Type.Optional(Type.String()),
	expires: Type.Optional(Type.String()),
});

const UnclaimEvent = Type.Object({ ...BASE, type: Type.Literal("unclaim") });
const ExpireEvent = Type.Object({ ...BASE, type: Type.Literal("expire") });

const CompleteEvent = Type.Object({
	...BASE,
	type: Type.Literal("complete"),
	duration: Type.Optional(Type.String()),
	verification_required: Type.Optional(Type.Boolean()),
	checks: Type.Optional(Type.Array(CHECK_ITEM)),
});

const BlockEvent = Type.Object({
	...BASE,
	type: Type.Literal("block"),
	reason: Type.Optional(Type.String()),
});

const UnblockEvent = Type.Object({
	...BASE,
	type: Type.Literal("unblock"),
	resolution: Type.Optional(Type.String()),
});

const NoteEvent = Type.Object({
	...BASE,
	type: Type.Literal("note"),
	text: Type.String(),
});

const DeleteEvent = Type.Object({
	...BASE,
	type: Type.Literal("delete"),
	reason: Type.Optional(Type.String()),
});

const EditEvent = Type.Object({
	...BASE,
	type: Type.Literal("edit"),
	title: Type.Optional(Type.String()),
	priority: Type.Optional(Type.String()),
	tags: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
});

export const KanbanEventSchema = Type.Union([
	CreateEvent,
	MoveEvent,
	ClaimEvent,
	UnclaimEvent,
	ExpireEvent,
	CompleteEvent,
	BlockEvent,
	UnblockEvent,
	NoteEvent,
	DeleteEvent,
	EditEvent,
]);

export type KanbanEvent = Static<typeof KanbanEventSchema>;

/** Shared envelope fields for a new event, minus the version and type. */
interface KanbanEventFields {
	readonly ts: string;
	readonly task_id: string;
	readonly agent: string;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Fields specific to one event type, with the shared envelope removed. */
type KanbanEventExtras<T extends KanbanEvent["type"]> = DistributiveOmit<
	Extract<KanbanEvent, { type: T }>,
	"v" | "type" | keyof KanbanEventFields
>;

/** Build one versioned event from envelope fields plus type-specific extras. */
export function makeEvent<T extends KanbanEvent["type"]>(
	type: T,
	fields: KanbanEventFields,
	extras: KanbanEventExtras<T>,
): KanbanEvent {
	return { v: KANBAN_EVENT_VERSION, ...fields, type, ...extras } as KanbanEvent;
}

/** Encode/decode one typed event as a single JSONL line. */
export const kanbanEventCodec: EventLogCodec<KanbanEvent> = {
	encode: (event) => JSON.stringify(event),
	decode: (line) => {
		const parsed = JSON.parse(line) as unknown;
		const future = futureVersion(parsed);
		if (future !== null) throw new KanbanEventVersionError(future);
		if (!Check(KanbanEventSchema, parsed)) {
			throw new Error("Invalid kanban event line");
		}
		return parsed as KanbanEvent;
	},
};

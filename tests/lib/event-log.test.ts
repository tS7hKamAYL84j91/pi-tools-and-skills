import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../../lib/event-log.js";

const temporaryDirectories: string[] = [];

async function makeLog(): Promise<EventLog<{ readonly value: number }>> {
	const directory = await mkdtemp(join(tmpdir(), "pi-event-log-"));
	temporaryDirectories.push(directory);
	return new EventLog(join(directory, "events.jsonl"));
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("EventLog", () => {
	it("appends and replays events in order", async () => {
		const log = await makeLog();
		await log.append({ value: 1 });
		await log.append([{ value: 2 }, { value: 3 }]);
		expect(await log.read()).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
	});

	it("replays a missing log as empty", async () => {
		const log = await makeLog();
		expect(await log.read()).toEqual([]);
	});

	it("writes snapshots and compacts under the same lock", async () => {
		const log = await makeLog();
		await log.append([{ value: 1 }, { value: 2 }, { value: 3 }]);
		const snapshotPath = join(tmpdir(), `event-snapshot-${Date.now()}.json`);
		const backupPath = `${snapshotPath}.backup`;
		try {
			await log.snapshot(snapshotPath, { value: 2 });
			const result = await log.compact([{ value: 2 }, { value: 3 }], { backupPath });
			expect(result).toMatchObject({ eventsBefore: 3, eventsAfter: 2, backupPath });
			expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toEqual({ value: 2 });
			expect(await log.read()).toEqual([{ value: 2 }, { value: 3 }]);
			expect((await readFile(backupPath, "utf8")).trim().split("\n")).toHaveLength(3);
		} finally {
			await Promise.all([rm(snapshotPath, { force: true }), rm(backupPath, { force: true })]);
		}
	});

	it("preserves arbitrary generated event sequences", async () => {
		await fc.assert(fc.asyncProperty(fc.array(fc.integer()), async (values) => {
			const log = await makeLog();
			const events = values.map((value) => ({ value }));
			await log.append(events);
			expect(await log.read()).toEqual(events);
		}));
	});
});

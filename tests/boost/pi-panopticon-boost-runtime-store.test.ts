import { describe, expect, it } from "vitest";
import {
	DaemonBoostControlStore,
	type DaemonBoostWal,
	type DaemonBoostWalRecord,
} from "../../extensions/pi-boost/daemon-boost-control-store.js";

class MemoryWal implements DaemonBoostWal {
	readonly records: DaemonBoostWalRecord[] = [];
	failNextAppend = false;

	async read(): Promise<readonly DaemonBoostWalRecord[]> {
		return this.records;
	}

	async appendIfSequence(
		expectedSequence: number,
		record: DaemonBoostWalRecord,
	): Promise<"appended" | "conflict"> {
		if (this.failNextAppend) {
			this.failNextAppend = false;
			throw new Error("private WAL failure");
		}
		const actualSequence = this.records.at(-1)?.sequence ?? 0;
		if (actualSequence !== expectedSequence) {
			return "conflict";
		}
		this.records.push(structuredClone(record));
		return "appended";
	}
}

const KEY = {
	enablementId: "enablement-a",
	subjectId: "subject-a",
	leaseId: "lease-a",
};

describe("T-843 daemon boost control store", () => {
	it("serializes competing reservations and enforces one global lease", async () => {
		const store = await DaemonBoostControlStore.open(new MemoryWal());
		const competingKey = {
			enablementId: "enablement-b",
			subjectId: "subject-b",
			leaseId: "lease-b",
		};

		const results = await Promise.all([
			store.reserve({ ...KEY, requestedYields: 2, qYieldCeiling: 3 }),
			store.reserve({ ...competingKey, requestedYields: 1, qYieldCeiling: 3 }),
		]);

		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.filter((result) => !result.ok)).toEqual([
			{ ok: false, reason: "global-lease-occupied" },
		]);
	});

	it("uses the WAL CAS boundary across independent store instances", async () => {
		const wal = new MemoryWal();
		const first = await DaemonBoostControlStore.open(wal);
		const second = await DaemonBoostControlStore.open(wal);

		const results = await Promise.all([
			first.reserve({ ...KEY, requestedYields: 1, qYieldCeiling: 3 }),
			second.reserve({
				enablementId: "enablement-b",
				subjectId: "subject-b",
				leaseId: "lease-b",
				requestedYields: 1,
				qYieldCeiling: 3,
			}),
		]);

		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(
			wal.records.filter((record) => record.action === "reserve"),
		).toHaveLength(1);
	});

	it.each([
		{ requestedYields: 0, qYieldCeiling: 3 },
		{ requestedYields: 4, qYieldCeiling: 4 },
		{ requestedYields: 3, qYieldCeiling: 2 },
	])("rejects invalid or over-ceiling yield budget %#", async (budget) => {
		const wal = new MemoryWal();
		const store = await DaemonBoostControlStore.open(wal);

		expect(await store.reserve({ ...KEY, ...budget })).toEqual({
			ok: false,
			reason: "invalid-yield-budget",
		});
		expect(wal.records).toEqual([]);
	});

	it("appends before mutation and rolls back every failed WAL step", async () => {
		const wal = new MemoryWal();
		const store = await DaemonBoostControlStore.open(wal);
		wal.failNextAppend = true;

		expect(
			await store.reserve({ ...KEY, requestedYields: 2, qYieldCeiling: 3 }),
		).toEqual({ ok: false, reason: "wal-unavailable" });
		expect(store.snapshot()).toEqual({ blockedSubjects: [], leases: [] });

		expect(
			await store.reserve({ ...KEY, requestedYields: 2, qYieldCeiling: 3 }),
		).toMatchObject({ ok: true });
		const activation = await store.activate(KEY);
		expect(activation).toMatchObject({ ok: true, value: { generation: 1 } });
		wal.failNextAppend = true;
		expect(
			await store.consume({ ...KEY, generation: 1, humanVisible: true }),
		).toEqual({ ok: false, reason: "wal-unavailable" });
		expect(store.snapshot().leases[0]).toMatchObject({
			consumedYields: 0,
			state: "Active",
		});
		wal.failNextAppend = true;
		expect(await store.release(KEY)).toEqual({
			ok: false,
			reason: "wal-unavailable",
		});
		expect(store.snapshot().leases).toHaveLength(1);

		const recovered = await DaemonBoostControlStore.open(wal);
		expect(recovered.checkDispatch(KEY.subjectId)).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
	});

	it("preserves a failed restart marker through transaction replay", async () => {
		const wal = new MemoryWal();
		const active = await DaemonBoostControlStore.open(wal);
		await active.reserve({ ...KEY, requestedYields: 1, qYieldCeiling: 1 });
		wal.failNextAppend = true;

		const recovered = await DaemonBoostControlStore.open(wal);
		expect(recovered.checkDispatch(KEY.subjectId)).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
		expect(
			await recovered.reserve({ ...KEY, requestedYields: 1, qYieldCeiling: 1 }),
		).toEqual({ ok: false, reason: "blocked-subject" });
	});

	it("invalidates an activation generation before revocation", async () => {
		const store = await DaemonBoostControlStore.open(new MemoryWal());
		await store.reserve({ ...KEY, requestedYields: 1, qYieldCeiling: 1 });
		await store.activate(KEY);

		expect(await store.markRevoking({ ...KEY, generation: 1 })).toMatchObject({
			ok: true,
		});
		expect(
			await store.consume({ ...KEY, generation: 1, humanVisible: true }),
		).toEqual({
			ok: false,
			reason: "stale-activation",
		});
	});

	it("persists consume/release and rejects stale activation generations", async () => {
		const wal = new MemoryWal();
		const store = await DaemonBoostControlStore.open(wal);
		await store.reserve({ ...KEY, requestedYields: 2, qYieldCeiling: 3 });
		await store.activate(KEY);
		await store.consume({ ...KEY, generation: 1, humanVisible: true });
		const second = await store.activate(KEY);

		expect(second).toMatchObject({ ok: true, value: { generation: 2 } });
		expect(
			await store.consume({ ...KEY, generation: 1, humanVisible: true }),
		).toEqual({ ok: false, reason: "stale-activation" });
		expect(
			await store.consume({ ...KEY, generation: 2, humanVisible: false }),
		).toMatchObject({ ok: true, value: { consumedYields: 1 } });
		expect(await store.release(KEY)).toMatchObject({ ok: true });

		const replayed = await DaemonBoostControlStore.open(wal);
		expect(replayed.snapshot()).toEqual({ blockedSubjects: [], leases: [] });
	});

	it("cannot activate beyond the durable three-yield budget", async () => {
		const store = await DaemonBoostControlStore.open(new MemoryWal());
		await store.reserve({ ...KEY, requestedYields: 3, qYieldCeiling: 3 });
		for (const generation of [1, 2, 3]) {
			expect(await store.activate(KEY)).toMatchObject({
				ok: true,
				value: { generation },
			});
			await store.consume({ ...KEY, generation, humanVisible: true });
		}

		expect(await store.activate(KEY)).toEqual({
			ok: false,
			reason: "invalid-yield-budget",
		});
	});

	it("durably blocks only the failed subject until reset", async () => {
		const wal = new MemoryWal();
		const store = await DaemonBoostControlStore.open(wal);
		await store.reserve({ ...KEY, requestedYields: 1, qYieldCeiling: 1 });
		await store.markBlocked({
			...KEY,
			category: "restore-failed",
		});

		const replayed = await DaemonBoostControlStore.open(wal);
		expect(replayed.checkDispatch("subject-a")).toEqual({
			allowed: false,
			reason: "revert-failed",
		});
		expect(replayed.checkDispatch("subject-b")).toEqual({ allowed: true });
		expect(await replayed.resetBlocked("subject-a")).toMatchObject({
			ok: true,
		});
		expect(replayed.checkDispatch("subject-a")).toEqual({ allowed: true });
	});
});

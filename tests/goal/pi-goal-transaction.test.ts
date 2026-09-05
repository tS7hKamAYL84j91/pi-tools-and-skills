import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTextGoal, loadGoal, transactGoal } from "../../extensions/pi-goal/goal-persist.js";
import { admitGoal, claimGoal, releaseGoal, revokeGoal } from "../../extensions/pi-goal/goal-ownership.js";
import { goalPaths } from "../../extensions/pi-goal/goal-types.js";
import type { GoalExpected, GoalState } from "../../extensions/pi-goal/goal-types.js";

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("pi-goal revision transaction seam", () => {
	it("allows exactly one competing claim and rejects stale admission", async () => {
		const cwd = await temporaryDirectory();
		const initial = await createTextGoal(cwd, "ownership");
		const created = await transactGoal(cwd, undefined, "absent", () => ({ ...initial, runActive: true }));
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		const [first, second] = await Promise.all([claimGoal(cwd, undefined, "driver-a"), claimGoal(cwd, undefined, "driver-b")]);
		expect([first, second].filter((result) => result.status === "applied")).toHaveLength(1);
		const winner = first.status === "applied" ? first.state : second.status === "applied" ? second.state : null;
		if (!winner?.owner) throw new Error("Expected owner");
		const admitted = await admitGoal(cwd, undefined, winner.owner, 1);
		expect(admitted.status).toBe("applied");
		const stale = await admitGoal(cwd, undefined, { token: "stale", generation: winner.owner.generation }, 2);
		expect(stale.status).toBe("conflict");
	});

	it("revoke and release are exact-token transitions and generations do not repeat", async () => {
		const cwd = await temporaryDirectory();
		const initial = { ...await createTextGoal(cwd, "revoke"), runActive: true };
		await transactGoal(cwd, undefined, "absent", () => initial);
		const claimed = await claimGoal(cwd, undefined, "driver");
		if (claimed.status !== "applied" || !claimed.state?.owner) throw new Error("Expected claim");
		const owner = claimed.state.owner;
		expect((await releaseGoal(cwd, undefined, { token: "wrong", generation: owner.generation })).status).toBe("conflict");
		expect((await revokeGoal(cwd, undefined, owner)).status).toBe("applied");
		const stopped = await loadGoal(cwd);
		if (!stopped) { throw new Error("Expected stopped state"); }
		await transactGoal(cwd, undefined, { goalId: stopped.goalId, revision: stopped.revision }, current => current && { ...current, runActive: true });
		const replacement = await claimGoal(cwd, undefined, "replacement");
		if (replacement.status !== "applied" || !replacement.state?.owner) throw new Error("Expected replacement claim");
		expect(replacement.state.owner.generation).toBeGreaterThan(owner.generation);
	});
	it("applies exactly one of two concurrent expected-revision mutations", async () => {
		const cwd = await temporaryDirectory();
		const initial = await createTextGoal(cwd, "transactional goal");
		const created = await transactGoal(cwd, undefined, "absent", () => initial);
		expect(created.status).toBe("applied");
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		const expected: GoalExpected = { goalId: created.state.goalId, revision: created.state.revision };
		const mutate = (objective: string) => transactGoal(cwd, undefined, expected, (current: GoalState | null) => ({ ...current!, objective }));
		const results = await Promise.all([mutate("winner-a"), mutate("winner-b")]);
		expect(results.filter((result) => result.status === "applied")).toHaveLength(1);
		expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
	});

	it("rejects reducer identity and owner shape changes", async () => {
		const cwd = await temporaryDirectory();
		const initial = await createTextGoal(cwd, "identity goal");
		const created = await transactGoal(cwd, undefined, "absent", () => ({ ...initial, runActive: true, owner: { token: "owner", generation: 1 } }));
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		const expected = { goalId: created.state.goalId, revision: created.state.revision, owner: { token: "owner", generation: 1 } };
		await expect(transactGoal(cwd, undefined, expected, (current) => ({ ...current!, goalId: "other" }))).rejects.toThrow("goalId");
		await expect(transactGoal(cwd, undefined, expected, (current) => ({ ...current!, owner: undefined }))).rejects.toThrow("owner");
		await expect(transactGoal(cwd, undefined, expected, (current) => ({ ...current!, owner: { token: "", generation: 0 } }))).rejects.toThrow("owner");
	});

	it("rejects an owner mismatch without applying the reducer", async () => {
		const cwd = await temporaryDirectory();
		const initial = await createTextGoal(cwd, "owner goal");
		const created = await transactGoal(cwd, undefined, "absent", () => initial);
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		const result = await transactGoal(cwd, undefined, {
			goalId: created.state.goalId,
			revision: created.state.revision,
			owner: { token: "wrong", generation: 1 },
		}, () => {
			throw new Error("Reducer must not run on owner conflict");
		});
		expect(result.status).toBe("conflict");
	});

	it("strictly parses persisted owner records without dropping identity", async () => {
		const cases: readonly [string, unknown][] = [
			["null", null],
			["scalar", "owner"],
			["missing token", { generation: 1 }],
			["empty token", { token: "", generation: 1 }],
			["zero generation", { token: "owner", generation: 0 }],
			["fractional generation", { token: "owner", generation: 1.5 }],
			["string generation", { token: "owner", generation: "1" }],
			["overlong token", { token: "x".repeat(129), generation: 1 }],
		];
		for (const [label, owner] of cases) {
			const cwd = await temporaryDirectory();
			await writeRawGoal(cwd, { owner });
			await expect(loadGoal(cwd), label).rejects.toThrow("owner");
		}

		const cwd = await temporaryDirectory();
		const token = "exact-token-without-truncation";
		await writeRawGoal(cwd, { owner: { token, generation: 7 } });
		const loaded = await loadGoal(cwd);
		expect(loaded?.owner).toEqual({ token, generation: 7 });
		if (!loaded) throw new Error("Expected valid owner");
		const result = await transactGoal(cwd, undefined, { goalId: loaded.goalId, revision: loaded.revision, owner: loaded.owner }, (current) => ({ ...current!, objective: "owner mutation" }));
		expect(result.status).toBe("applied");
	});

	it("rejects malformed revisions and applies only the first legacy mutation", async () => {
		const malformed: readonly unknown[] = [null, "1", -1, 1.5];
		for (const revision of malformed) {
			const cwd = await temporaryDirectory();
			await writeRawGoal(cwd, { schemaVersion: 3, revision });
			await expect(loadGoal(cwd)).rejects.toThrow("revision must be a non-negative integer");
		}

		const cwd = await temporaryDirectory();
		await writeRawGoal(cwd, { schemaVersion: 1, revision: undefined });
		const loaded = await loadGoal(cwd);
		if (!loaded) throw new Error("Expected legacy state");
		const expected = { goalId: loaded.goalId, revision: 0 };
		const first = await transactGoal(cwd, undefined, expected, (current) => ({ ...current!, objective: "first" }));
		expect(first).toMatchObject({ status: "applied", previousRevision: 0 });
		const stale = await transactGoal(cwd, undefined, expected, (current) => ({ ...current!, objective: "stale" }));
		expect(stale).toMatchObject({ status: "conflict" });
	});

	it("reads legacy authority without rewriting it", async () => {
		const cwd = await temporaryDirectory();
		const raw = JSON.stringify({
			schemaVersion: 1,
			goalId: "legacy",
			objective: "legacy",
			status: "active",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			runActive: false,
			turnBudget: 0,
			turnsUsed: 0,
			currentMilestoneIndex: 0,
			milestones: [],
		});
		await mkdir(join(cwd, ".pi/goal"), { recursive: true });
		await writeFile(join(cwd, ".pi/goal/goal.json"), raw, "utf8");
		await expect(loadGoal(cwd)).resolves.toMatchObject({ revision: 0 });
		expect(await readFile(join(cwd, ".pi/goal/goal.json"), "utf8")).toBe(raw);
	});

	it("fails closed for a bound instance with missing authority", async () => {
		const cwd = await temporaryDirectory();
		const flat = await createTextGoal(cwd, "flat authority");
		const flatResult = await transactGoal(cwd, undefined, "absent", () => flat);
		expect(flatResult.status).toBe("applied");
		const scope = boundScope(cwd, "bound-goal");

		await expect(loadGoal(cwd, scope)).resolves.toBeNull();
		const result = await transactGoal(cwd, scope, { goalId: "bound-goal", revision: 0 }, (current) => ({
			...(current ?? flat),
			goalId: "bound-goal",
			objective: "must not be created",
		}));
		expect(result.status).toBe("conflict");
		expect((await loadGoal(cwd))?.objective).toBe("flat authority");
	});

	it("fails closed for a bound instance with invalid authority JSON", async () => {
		const cwd = await temporaryDirectory();
		const flat = await createTextGoal(cwd, "flat authority");
		const flatResult = await transactGoal(cwd, undefined, "absent", () => flat);
		expect(flatResult.status).toBe("applied");
		const goalId = "bound-goal";
		await mkdir(goalPaths(cwd, goalId).dir, { recursive: true });
		await writeFile(goalPaths(cwd, goalId).statePath, "{ invalid", "utf8");
		const scope = boundScope(cwd, goalId);

		await expect(loadGoal(cwd, scope)).rejects.toThrow();
		await expect(transactGoal(cwd, scope, { goalId, revision: 0 }, (current) => current)).rejects.toThrow();
		expect((await loadGoal(cwd))?.objective).toBe("flat authority");
	});

	it("rejects non-regular authority and projection entries in flat and instance paths", async () => {
		const flat = await temporaryDirectory();
		await mkdir(join(flat, ".pi/goal"), { recursive: true });
		await mkdir(join(flat, ".pi/goal/goal.json"));
		await expect(loadGoal(flat)).rejects.toThrow("not a regular file");

		const instance = await temporaryDirectory();
		const instanceRoot = join(instance, ".pi/goal/instances/instance-goal");
		await mkdir(join(instanceRoot, "goal.json"), { recursive: true });
		const scope = { cwd: instance, sessionManager: { getBranch: () => [{ type: "custom", customType: "pi-goal:binding", data: { goalId: "instance-goal" } }] } };
		await expect(loadGoal(instance, scope)).rejects.toThrow("not a regular file");

		const projection = await temporaryDirectory();
		const initial = await createTextGoal(projection, "unsafe projection directory");
		const created = await transactGoal(projection, undefined, "absent", () => initial);
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		await rm(join(projection, ".pi/goal/GOAL.md"), { force: true });
		await mkdir(join(projection, ".pi/goal/GOAL.md"));
		const deleted = await transactGoal(projection, undefined, { goalId: created.state.goalId, revision: created.state.revision }, () => null);
		expect(deleted).toMatchObject({ status: "applied", state: null, projection: "failed" });
	});

	it("rejects symlinked authority entries and unsafe deletion projections", async () => {
		const cwd = await temporaryDirectory();
		const outside = await mkdtemp(join(tmpdir(), "pi-goal-outside-"));
		directories.push(outside);
		await writeFile(join(outside, "goal.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
		await mkdir(join(cwd, ".pi/goal"), { recursive: true });
		await (await import("node:fs/promises")).symlink(join(outside, "goal.json"), join(cwd, ".pi/goal/goal.json"));
		await expect(loadGoal(cwd)).rejects.toThrow("symlink");

		const instanceRoot = join(cwd, ".pi/goal/instances/instance-goal");
		await mkdir(instanceRoot, { recursive: true });
		await (await import("node:fs/promises")).symlink(join(outside, "goal.json"), join(instanceRoot, "goal.json"));
		const instanceScope = {
			cwd,
			sessionManager: {
				getBranch: () => [{ type: "custom", customType: "pi-goal:binding", data: { goalId: "instance-goal" } }],
			},
		};
		await expect(loadGoal(cwd, instanceScope)).rejects.toThrow("symlink");

		const clean = await temporaryDirectory();
		const initial = await createTextGoal(clean, "unsafe projection");
		const created = await transactGoal(clean, undefined, "absent", () => initial);
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		await rm(join(clean, ".pi/goal/GOAL.md"), { force: true });
		await (await import("node:fs/promises")).symlink(join(outside, "goal.json"), join(clean, ".pi/goal/GOAL.md"));
		const deleted = await transactGoal(clean, undefined, { goalId: created.state.goalId, revision: created.state.revision }, () => null);
		expect(deleted).toMatchObject({ status: "applied", state: null, projection: "failed" });
	});

	it("reports committed authority with failed projection separately", async () => {
		const cwd = await temporaryDirectory();
		const initial = await createTextGoal(cwd, "projection failure");
		await mkdir(join(cwd, ".pi/goal", "GOAL.md"), { recursive: true });
		const result = await transactGoal(cwd, undefined, "absent", () => initial);
		expect(result).toMatchObject({ status: "applied", projection: "failed" });
		const authority = JSON.parse(await readFile(join(cwd, ".pi/goal", "goal.json"), "utf8")) as GoalState;
		expect(authority.objective).toBe("projection failure");
	});

	it("deletes only the authoritative instance and releases the lock on reducer failure", async () => {
		const cwd = await temporaryDirectory();
		const initial = await createTextGoal(cwd, "delete me");
		const created = await transactGoal(cwd, undefined, "absent", () => initial);
		if (created.status !== "applied" || created.state === null) throw new Error("Expected created state");
		const expected = { goalId: created.state.goalId, revision: created.state.revision };
		await expect(transactGoal(cwd, undefined, expected, () => { throw new Error("reducer failure"); })).rejects.toThrow("reducer failure");
		const deleted = await transactGoal(cwd, undefined, expected, () => null);
		expect(deleted).toMatchObject({ status: "applied", state: null, projection: "complete" });
		expect(await loadGoal(cwd)).toBeNull();
	});
});

function boundScope(cwd: string, goalId: string) {
	return {
		cwd,
		sessionManager: {
			getBranch: () => [{ type: "custom", customType: "pi-goal:binding", data: { goalId } }],
		},
	};
}

async function writeRawGoal(cwd: string, fields: Record<string, unknown>): Promise<void> {
	await mkdir(join(cwd, ".pi/goal"), { recursive: true });
	await writeFile(join(cwd, ".pi/goal/goal.json"), JSON.stringify({
		schemaVersion: 3,
		revision: 0,
		goalId: "raw-goal",
		objective: "raw",
		status: "active",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		runActive: false,
		turnBudget: 0,
		turnsUsed: 0,
		currentMilestoneIndex: 0,
		milestones: [],
		...fields,
	}), "utf8");
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-goal-transaction-"));
	directories.push(directory);
	return directory;
}

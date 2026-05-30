import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendLogLine,
	updateJsonFile,
	writeFileAtomic,
} from "../../lib/file-persistence.js";

let tempDir = "";

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pi-persistence-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("file persistence helpers", () => {
	it("writes complete files through the atomic helper", async () => {
		const path = join(tempDir, "nested", "state.txt");
		await writeFileAtomic(path, "hello\n");
		expect(await readFile(path, "utf8")).toBe("hello\n");
	});

	it("appends complete log lines", async () => {
		const path = join(tempDir, "logs", "events.log");
		await appendLogLine(path, "one");
		await appendLogLine(path, "two\n");
		expect(await readFile(path, "utf8")).toBe("one\ntwo\n");
	});

	it("updates JSON files with an atomic rewrite", async () => {
		const path = join(tempDir, "state", "count.json");
		const next = await updateJsonFile(
			path,
			(current) => ({ count: current.count + 1 }),
			{
				defaultValue: { count: 0 },
			},
		);
		expect(next).toEqual({ count: 1 });
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ count: 1 });
	});
});

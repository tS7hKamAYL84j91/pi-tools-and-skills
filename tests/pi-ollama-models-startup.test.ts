/**
 * pi-ollama-models startup classification: a missing binary or a stopped local
 * service is reported on the status line only, while a broken configuration
 * still warns. No network or real Ollama install is touched.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import ollamaModelsExtension from "../extensions/pi-ollama-models/index.js";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

const dirs: string[] = [];
const previousCommand = process.env.PI_OLLAMA_COMMAND;

afterEach(async () => {
	if (previousCommand === undefined) delete process.env.PI_OLLAMA_COMMAND;
	else process.env.PI_OLLAMA_COMMAND = previousCommand;
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, { encoding: "utf8", mode: 0o700 });
}

interface Startup {
	readonly status: () => string | undefined;
	readonly warnings: () => string[];
}

/** Register the extension, fire session_start, and capture UI feedback. */
async function runStartup(): Promise<Startup> {
	let handler: Handler | undefined;
	ollamaModelsExtension({
		on: (event: string, value: Handler) => {
			if (event === "session_start") handler = value;
		},
		registerTool: () => {},
	} as unknown as ExtensionAPI);
	if (!handler) throw new Error("session_start was not registered");

	const statuses = new Map<string, string>();
	const notify = vi.fn();
	await handler({}, {
		ui: {
			setStatus: (key: string, value: string) => statuses.set(key, value),
			notify,
		},
	});

	return {
		status: () => statuses.get("ollama"),
		warnings: () => notify.mock.calls.map((call) => `${String(call[1])}: ${String(call[0])}`),
	};
}

describe("pi-ollama-models startup reporting", () => {
	it("reports a stopped local service on the status line without a warning", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-ollama-service-"));
		dirs.push(root);
		const command = join(root, "ollama");
		await writeExecutable(command, "#!/bin/sh\necho 'connection refused' >&2\nexit 1\n");
		process.env.PI_OLLAMA_COMMAND = command;

		const startup = await runStartup();

		expect(startup.status()).toBe("ollama: unavailable");
		expect(startup.warnings()).toEqual([]);
	});

	it("still warns when the configured command is rejected", async () => {
		process.env.PI_OLLAMA_COMMAND = "ollama";

		const startup = await runStartup();

		expect(startup.status()).toBe("ollama: skipped");
		expect(startup.warnings()).toHaveLength(1);
		expect(startup.warnings()[0]).toContain("warning");
		expect(startup.warnings()[0]).toContain("absolute path");
	});
});

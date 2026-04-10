/**
 * Integration tests for machine-memory tool wrappers (extensions/machine-memory/index.ts).
 *
 * Loads the extension against a fake ExtensionAPI that captures registered
 * tools/commands/handlers. Mocks node:os homedir() so memory discovery scans
 * an isolated tmp HOME instead of the developer's real ~/.pi/agent/memories/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolResult } from "../lib/tool-result.js";

// ── Mock node:os to redirect homedir() to a per-test tmp dir ─────
//
// The mmem discover module reads ~/.pi/agent/memories/ via os.homedir().
// We hoist a mutable holder via vi.hoisted() so the mock factory and the
// per-test setup share the same reference, letting each test isolate to
// its own tmp HOME without leaking real memories into the test run.

const { homeHolder } = vi.hoisted(() => ({ homeHolder: { current: "/tmp" } }));

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return { ...actual, homedir: () => homeHolder.current };
});

// Static import is fine: discover.ts calls homedir() lazily on every call
import mmemExtension from "../extensions/machine-memory/index.js";

// ── Fake ExtensionAPI ────────────────────────────────────────────

interface RegisteredTool {
	name: string;
	execute: (id: string, params: any, signal?: AbortSignal, onUpdate?: any, ctx?: any) => Promise<ToolResult>;
}

interface RegisteredCommand {
	handler: (args: string, ctx: any) => Promise<unknown> | unknown;
}

function createFakeApi() {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: any, ctx: any) => Promise<unknown> | unknown>();
	const api = {
		registerTool(def: RegisteredTool) { tools.set(def.name, def); },
		registerCommand(name: string, opts: RegisteredCommand) { commands.set(name, opts); },
		registerFlag(_name: string, _opts: unknown) { /* no-op */ },
		on(event: string, handler: (e: any, c: any) => unknown) { handlers.set(event, handler as any); },
		getFlag(_name: string) { return undefined; },
		sendUserMessage(_msg: string, _opts?: unknown) { /* no-op */ },
	};
	return { api, tools, commands, handlers };
}

function makeCtx(cwd: string) {
	return {
		cwd,
		ui: {
			setStatus: () => { /* no-op */ },
			setWidget: () => { /* no-op */ },
			notify: () => { /* no-op */ },
			custom: async () => null,
		},
	};
}

async function callTool(tools: Map<string, RegisteredTool>, name: string, params: Record<string, unknown>, cwd: string): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool not registered: ${name}`);
	return tool.execute("test-call-id", params, undefined, undefined, makeCtx(cwd));
}

// ── Test fixture ─────────────────────────────────────────────────

let homeDir: string;
let projectDir: string;
let tools: Map<string, RegisteredTool>;
let handlers: Map<string, (event: any, ctx: any) => Promise<unknown> | unknown>;

beforeEach(async () => {
	homeDir = mkdtempSync(join(tmpdir(), "mmem-home-"));
	projectDir = mkdtempSync(join(tmpdir(), "mmem-proj-"));
	mkdirSync(join(homeDir, ".pi", "agent", "memories"), { recursive: true });
	mkdirSync(join(projectDir, ".pi", "memories"), { recursive: true });
	homeHolder.current = homeDir;

	const fake = createFakeApi();
	mmemExtension(fake.api as any);
	tools = fake.tools;
	handlers = fake.handlers;

	// Fire session_start so loadedMemories gets populated from our isolated tmp dirs
	await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, makeCtx(projectDir));
});

afterEach(async () => {
	// Tear down loadedMemories so the next test starts clean
	await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, makeCtx(projectDir));
	rmSync(homeDir, { recursive: true, force: true });
	rmSync(projectDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────

describe("mmem_create", () => {
	it("writes a skeleton .mmem.yml to the project memories dir", async () => {
		const result = await callTool(tools, "mmem_create", {
			tool: "test-skel",
			target: "project",
			category: "test",
			tags: "alpha,beta",
		}, projectDir);

		expect(result.isError).toBeFalsy();
		expect(result.details.tool).toBe("test-skel");
		expect(result.details.skeleton).toBe(true);

		const expected = join(projectDir, ".pi", "memories", "test-skel.mmem.yml");
		expect(existsSync(expected)).toBe(true);

		const body = readFileSync(expected, "utf-8");
		expect(body).toContain("tool: test-skel");
		expect(body).toContain("category: test");
		expect(body).toContain("[alpha, beta]");
		expect(body).toContain("# test-skel — TODO");
	});

	it("writes full content when 'content' param is provided and valid", async () => {
		const validContent = `---
tool: test-full
version: ">=1.0"
updated: 2026-04-10
category: test
tags: [test]
confidence: high
---

# test-full — Test memory file

> A complete memory used to verify mmem_create accepts pre-built content.

## Common operations

- run thing:
  \`test-full run\`

## Gotchas

- be careful with state
`;
		const result = await callTool(tools, "mmem_create", {
			tool: "test-full",
			target: "project",
			content: validContent,
		}, projectDir);

		expect(result.isError).toBeFalsy();
		expect(result.details.skeleton).toBe(false);

		const written = readFileSync(join(projectDir, ".pi", "memories", "test-full.mmem.yml"), "utf-8");
		expect(written).toBe(validContent);
	});

	it("rejects invalid content", async () => {
		const bad = "not yaml at all";
		await expect(
			callTool(tools, "mmem_create", { tool: "bad", target: "project", content: bad }, projectDir),
		).rejects.toThrow(/Invalid content/);
	});

	it("rejects creation when file already exists", async () => {
		await callTool(tools, "mmem_create", { tool: "twice", target: "project" }, projectDir);
		await expect(
			callTool(tools, "mmem_create", { tool: "twice", target: "project" }, projectDir),
		).rejects.toThrow(/already exists/);
	});

	it("reloads memories after creation so mmem_list sees the new file", async () => {
		await callTool(tools, "mmem_create", { tool: "fresh", target: "project", category: "test", tags: "x" }, projectDir);
		const list = await callTool(tools, "mmem_list", {}, projectDir);
		expect(list.details.count).toBe(1);
		const files = list.details.files as { name: string }[];
		expect(files.map((f) => f.name)).toContain("fresh");
	});
});

describe("mmem_inject", () => {
	beforeEach(async () => {
		// Pre-stage two memories then reload
		writeFileSync(
			join(projectDir, ".pi", "memories", "alpha.mmem.yml"),
			`---
tool: alpha
version: ">=1.0"
updated: 2026-04-10
category: test
tags: [alpha]
confidence: high
---

# alpha — Alpha tool

## Common operations

- do alpha:
  \`alpha run\`

## Gotchas

- alpha gotcha
`,
			"utf-8",
		);
		writeFileSync(
			join(projectDir, ".pi", "memories", "beta.mmem.yml"),
			`---
tool: beta
version: ">=1.0"
updated: 2026-04-10
category: test
tags: [beta]
confidence: high
---

# beta — Beta tool

## Common operations

- do beta:
  \`beta run\`

## Gotchas

- beta gotcha
`,
			"utf-8",
		);
		// Re-fire session_start to repopulate loadedMemories from the new files
		await handlers.get("session_start")?.({ type: "session_start", reason: "reload" }, makeCtx(projectDir));
	});

	it("injects requested memories and returns formatted content", async () => {
		const result = await callTool(tools, "mmem_inject", { tools: "alpha,beta" }, projectDir);
		expect(result.isError).toBeFalsy();

		const injected = result.details.injected as string[];
		expect(injected.sort()).toEqual(["alpha", "beta"]);
		expect(result.content[0]?.text).toContain("alpha");
		expect(result.content[0]?.text).toContain("beta");
		expect(result.content[0]?.text).toContain("<machine-memory>");
	});

	it("reports notFound for unknown tools but still injects known ones", async () => {
		const result = await callTool(tools, "mmem_inject", { tools: "alpha,does-not-exist" }, projectDir);
		expect(result.details.injected).toEqual(["alpha"]);
		expect(result.details.notFound).toEqual(["does-not-exist"]);
	});

	it("returns 'No memory files found' when nothing matches", async () => {
		const result = await callTool(tools, "mmem_inject", { tools: "nope1,nope2" }, projectDir);
		expect(result.content[0]?.text).toContain("No memory files found");
		// Note: this branch returns { found: [], notFound } instead of { injected, notFound }
		expect(result.details.found).toEqual([]);
		expect(result.details.notFound).toEqual(["nope1", "nope2"]);
	});
});

describe("mmem_update", () => {
	beforeEach(async () => {
		await callTool(tools, "mmem_create", { tool: "updatable", target: "project", category: "test", tags: "x" }, projectDir);
	});

	it("appends gotchas/patterns/corrections as a dated update block", async () => {
		const result = await callTool(tools, "mmem_update", {
			tool: "updatable",
			gotchas: "gotcha-1|gotcha-2",
			patterns: "pattern-1",
			corrections: "fix-1",
		}, projectDir);

		expect(result.isError).toBeFalsy();
		expect(result.details.updated).toBe(true);

		const body = readFileSync(join(projectDir, ".pi", "memories", "updatable.mmem.yml"), "utf-8");
		expect(body).toMatch(/# ── Update \d{4}-\d{2}-\d{2} ──+/);
		expect(body).toContain("## New Gotchas (suggested)");
		expect(body).toContain("- gotcha-1");
		expect(body).toContain("- gotcha-2");
		expect(body).toContain("## New Patterns (suggested)");
		expect(body).toContain("- pattern-1");
		expect(body).toContain("## Corrections (suggested)");
		expect(body).toContain("- fix-1");
	});

	it("returns updated:false when the tool isn't loaded", async () => {
		const result = await callTool(tools, "mmem_update", { tool: "nope", gotchas: "x" }, projectDir);
		expect(result.details.updated).toBe(false);
	});

	it("rejects updates with no content", async () => {
		await expect(
			callTool(tools, "mmem_update", { tool: "updatable" }, projectDir),
		).rejects.toThrow(/At least one of/);
	});
});

describe("mmem_validate", () => {
	it("validates a memory by tool name", async () => {
		await callTool(tools, "mmem_create", {
			tool: "valid-tool",
			target: "project",
			category: "test",
			tags: "x",
			content: `---
tool: valid-tool
version: ">=1.0"
updated: 2026-04-10
category: test
tags: [test]
confidence: high
---

# valid-tool — A valid memory

## Common operations

- run:
  \`valid-tool run\`

## Gotchas

- careful
`,
		}, projectDir);

		const result = await callTool(tools, "mmem_validate", { tool: "valid-tool" }, projectDir);
		expect(result.details.valid).toBe(true);
		expect(result.details.errors).toEqual([]);
	});

	it("flags missing required sections", async () => {
		const path = join(projectDir, ".pi", "memories", "broken.mmem.yml");
		writeFileSync(path, `---
tool: broken
version: ">=1.0"
updated: 2026-04-10
category: test
tags: [test]
confidence: medium
---

# broken — Missing sections

Just a body, no required sections.
`, "utf-8");

		const result = await callTool(tools, "mmem_validate", { path }, projectDir);
		expect(result.details.valid).toBe(false);
		const errs = result.details.errors as string[];
		expect(errs.some((e) => e.includes("Common operations"))).toBe(true);
	});
});

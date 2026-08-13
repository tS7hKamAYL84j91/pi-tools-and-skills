/** External-agent manifest, mailbox, and transport regression tests. */
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadExternalAgents,
	registerExternalAgent,
	unregisterExternalAgent,
} from "../../extensions/pi-panopticon/registry/external-registrar.js";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { createMaildirTransport } from "../../lib/transports/maildir.js";

interface TestConfig {
	workspaceRoot: string;
	mailboxRoot: string;
}

function makeConfig(): TestConfig {
	const workspaceRoot = mkdtempSync(join(tmpdir(), "pi-ext-agent-"));
	return { workspaceRoot, mailboxRoot: join(workspaceRoot, "mailboxes") };
}

function piPeer(name: string): AgentRecord {
	return {
		id: `pi-${randomUUID()}`,
		name,
		kind: "pi",
		pid: process.pid,
		cwd: "/tmp/pi-peer",
		model: "test/model",
		startedAt: Date.now(),
		heartbeat: Date.now(),
		status: "waiting",
	};
}

describe("external agent registrar", () => {
	let config: TestConfig;

	beforeEach(() => {
		config = makeConfig();
	});

	afterEach(() => {
		rmSync(config.workspaceRoot, { recursive: true, force: true });
	});

	it("uses one workspace manifest and creates the exact default Maildir tree", async () => {
		const record = await registerExternalAgent(config, { name: "worker-1" });
		const expectedMailbox = join(config.mailboxRoot, record.id, "inbox");

		expect(record).toMatchObject({
			kind: "external",
			name: "worker-1",
			mailboxPath: expectedMailbox,
		});
		const mailboxDirs = [expectedMailbox, ...["tmp", "new", "cur"].map((dir) => join(expectedMailbox, dir))];
		for (const dir of mailboxDirs) {
			expect(statSync(dir).isDirectory()).toBe(true);
			expect(statSync(dir).mode & 0o777).toBe(0o700);
		}
		expect(statSync(config.mailboxRoot).mode & 0o777).toBe(0o700);
		const manifest = join(config.workspaceRoot, "external-agents.json");
		expect(statSync(manifest).mode & 0o777).toBe(0o600);
		expect(await loadExternalAgents(config)).toHaveLength(1);

		const otherWorkspace = makeConfig();
		try {
			expect(await loadExternalAgents(otherWorkspace)).toEqual([]);
		} finally {
			rmSync(otherWorkspace.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("uses the resolved workspace root as cwd in register and load flows", async () => {
		const aliasedConfig = {
			...config,
			workspaceRoot: join(config.workspaceRoot, "nested", ".."),
		};

		const registered = await registerExternalAgent(aliasedConfig, { name: "worker-1" });
		const [loaded] = await loadExternalAgents(aliasedConfig);

		expect(registered.cwd).toBe(config.workspaceRoot);
		expect(loaded?.cwd).toBe(config.workspaceRoot);
		expect(registered.cwd).not.toBe(registered.mailboxPath);
		expect(loaded?.cwd).not.toBe(loaded?.mailboxPath);
	});

	it("treats a custom mailbox path as the final inbox path", async () => {
		const mailboxPath = join(config.mailboxRoot, "custom", "inbox");
		const record = await registerExternalAgent(config, { name: "worker-1", mailboxPath });

		expect(record.mailboxPath).toBe(mailboxPath);
		expect(existsSync(join(mailboxPath, "new"))).toBe(true);
		expect(existsSync(join(mailboxPath, record.id))).toBe(false);
	});

	it("rejects duplicate external and live pi names", async () => {
		await registerExternalAgent(config, { name: "worker-1" });
		await expect(registerExternalAgent(config, { name: "Worker-1" })).rejects.toThrow(/already registered/);
		await expect(
			registerExternalAgent(config, { name: "pi-worker" }, [piPeer("PI-WORKER")]),
		).rejects.toThrow(/already registered/);
	});

	it("serializes concurrent manifest updates without losing registrations", async () => {
		const names = Array.from({ length: 8 }, (_, index) => `worker-${index + 1}`);
		await Promise.all(names.map((name) => registerExternalAgent(config, { name })));

		const agents = await loadExternalAgents(config);
		expect(agents.map((agent) => agent.name).sort()).toEqual(names.sort());
	});

	it("allows only one concurrent registration for a duplicate name", async () => {
		const results = await Promise.allSettled([
			registerExternalAgent(config, { name: "worker-1" }),
			registerExternalAgent(config, { name: "worker-1" }),
		]);

		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect(await loadExternalAgents(config)).toHaveLength(1);
	});

	it("rejects relative and out-of-root mailbox paths", async () => {
		await expect(
			registerExternalAgent(config, { name: "relative", mailboxPath: "relative/inbox" }),
		).rejects.toThrow(/must be absolute/);
		await expect(
			registerExternalAgent(config, {
				name: "outside",
				mailboxPath: join(config.workspaceRoot, "outside", "inbox"),
			}),
		).rejects.toThrow(/must be inside/);
		expect(await loadExternalAgents(config)).toEqual([]);
	});

	it("rejects symlinks in a confined mailbox path", async () => {
		mkdirSync(config.mailboxRoot, { recursive: true });
		const target = join(config.mailboxRoot, "target");
		mkdirSync(target);
		const linked = join(config.mailboxRoot, "linked");
		symlinkSync(target, linked, "dir");

		await expect(
			registerExternalAgent(config, {
				name: "worker-1",
				mailboxPath: join(linked, "inbox"),
			}),
		).rejects.toThrow(/symlink/);
		expect(await loadExternalAgents(config)).toEqual([]);
	});

	it("fails closed on corrupt, non-array, and invalid manifests", async () => {
		const manifest = join(config.workspaceRoot, "external-agents.json");
		const invalidAuthorities = [
			"not-json",
			JSON.stringify({ entries: [] }),
			JSON.stringify([{
				version: 1,
				id: "../unsafe",
				name: "unsafe",
				kind: "external",
				mailboxPath: join(config.mailboxRoot, "ext-unsafe", "inbox"),
				startedAt: 1,
				heartbeat: 1,
				status: "waiting",
			}]),
		];

		for (const authority of invalidAuthorities) {
			writeFileSync(manifest, authority, "utf8");
			await expect(loadExternalAgents(config)).rejects.toThrow();
			await expect(registerExternalAgent(config, { name: "worker-1" })).rejects.toThrow();
			expect(readFileSync(manifest, "utf8")).toBe(authority);
		}
	});

	it("rejects a non-file manifest authority without overwriting it", async () => {
		const manifest = join(config.workspaceRoot, "external-agents.json");
		mkdirSync(manifest);

		await expect(loadExternalAgents(config)).rejects.toThrow(/regular file/);
		await expect(registerExternalAgent(config, { name: "worker-1" })).rejects.toThrow(/regular file/);
		expect(statSync(manifest).isDirectory()).toBe(true);
	});

	it("rejects and preserves a cross-workspace manifest symlink", async () => {
		const otherWorkspace = makeConfig();
		const foreignManifest = join(otherWorkspace.workspaceRoot, "external-agents.json");
		const authority = "not-this-workspace";
		writeFileSync(foreignManifest, authority, "utf8");
		const manifest = join(config.workspaceRoot, "external-agents.json");
		symlinkSync(foreignManifest, manifest);

		try {
			await expect(loadExternalAgents(config)).rejects.toThrow(/symlink/);
			await expect(registerExternalAgent(config, { name: "worker-1" })).rejects.toThrow(/symlink/);
			expect(lstatSync(manifest).isSymbolicLink()).toBe(true);
			expect(readFileSync(foreignManifest, "utf8")).toBe(authority);
		} finally {
			rmSync(otherWorkspace.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("unregisters metadata but preserves durable mailbox contents", async () => {
		const transport = createMaildirTransport();
		const record = await registerExternalAgent(config, { name: "worker-1" });
		await transport.send(record, "pi-session", "hello external");

		await unregisterExternalAgent(config, record.id);

		expect(await loadExternalAgents(config)).toEqual([]);
		expect(transport.receive(record.id, record.mailboxPath)).toEqual([
			expect.objectContaining({ from: "pi-session", text: "hello external" }),
		]);
	});

	it("delivers messages to an external mailbox", async () => {
		const transport = createMaildirTransport();
		const record = await registerExternalAgent(config, { name: "worker-1" });

		const result = await transport.send(record, "pi-session", "hello external");

		expect(result.accepted).toBe(true);
		expect(transport.receive(record.id, record.mailboxPath)).toEqual([
			expect.objectContaining({ from: "pi-session", text: "hello external" }),
		]);
	});
});

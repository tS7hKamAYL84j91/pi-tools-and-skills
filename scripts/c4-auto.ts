import { Workspace } from "structurizr-typescript";
import * as fs from "fs";
import * as path from "path";

// ── Model ───────────────────────────────────────────────────────

const workspace = new Workspace("Tools and Skills", "Architecture Model for the Pi Agent infrastructure");
const model = workspace.model;

// People
const dev = model.addPerson("Developer", "Uses pi CLI interactively");

// Systems
const pi = model.addSoftwareSystem("Pi Coding Agent", "CLI + LLM agent loop. Loads extensions, skills, prompts.");
const llm = model.addSoftwareSystem("LLM Provider", "Anthropic, OpenAI, etc.");
const fsSys = model.addSoftwareSystem("Shared Filesystem", "~/.pi/agents/ registry, Maildir queues, session JSONL");

// Containers
const ext = pi.addContainer("pi-panopticon", "Unified agent infrastructure: registry, messaging, spawning, monitoring", "TypeScript, Pi Extension");
const lib = pi.addContainer("lib/", "Shared interfaces and IO", "TypeScript");
const skills = pi.addContainer("skills/", "5 specialized agent skills: planning, research, red-team, weather, skill-creator", "Markdown + scripts");
const prompts = pi.addContainer("prompts/", "Prompt templates: refactor, commit-and-push", "Markdown");
const tests = pi.addContainer("tests/", "108 tests: registry, messaging, spawner, lifecycle, maildir", "Vitest");

// Components — pi-panopticon extension
const cIndex = ext.addComponent("index.ts", "Lifecycle wiring: session_start → shutdown. Connects all modules.");
cIndex.technology = "Orchestrator";
const cRegistry = ext.addComponent("registry.ts", "Single AgentRecord in memory. Heartbeat (5s). Dead-agent reaping. STATUS_SYMBOL map.");
cRegistry.technology = "Registry";
const cMessaging = ext.addComponent("messaging.ts", "agent_send, agent_broadcast, /send command. Inbox drain. Disposable cleanup hook.");
cMessaging.technology = "Messaging";
const cSpawner = ext.addComponent("spawner.ts", "spawn_agent, rpc_send, list_spawned, kill_agent. Graceful shutdownAll.");
cSpawner.technology = "Spawner";
const cPeek = ext.addComponent("peek.ts", "agent_peek tool. Lists agents or reads peer session JSONL.");
cPeek.technology = "Peek";
const cUi = ext.addComponent("ui.ts", "Powerline widget, /agents overlay, /alias command, Ctrl+Shift+O shortcut.");
cUi.technology = "UI";
const cTypes = ext.addComponent("types.ts", "Registry interface. Re-exports AgentRecord, ok/fail.");
cTypes.technology = "Types";

// Components — lib/
const cAgentReg = lib.addComponent("agent-registry.ts", "AgentRecord type, cleanup hooks, isPidAlive, ensureRegistryDir");
cAgentReg.technology = "Agent Registry";
const cTransport = lib.addComponent("message-transport.ts", "MessageTransport — DI boundary for messaging");
cTransport.technology = "Transport Interface";
const cMaildir = lib.addComponent("transports/maildir.ts", "At-least-once: atomic tmp/→new/ write, receive, ack, prune");
cMaildir.technology = "Maildir Transport";
const cSessionLog = lib.addComponent("session-log.ts", "readSessionLog(), formatSessionLog() — reads Pi JSONL");
cSessionLog.technology = "Session Log Reader";
const cToolResult = lib.addComponent("tool-result.ts", "ok(), fail() helpers");
cToolResult.technology = "Tool Result";

// ── Relationships ───────────────────────────────────────────────

// System level
dev.uses(pi, "Prompts, commands, /alias, /agents");
pi.uses(llm, "API calls (chat completions)");
pi.uses(fsSys, "Reads/writes agent records, messages, session logs");

// Container level
ext.uses(lib, "Imports types, IO, transports");
ext.uses(fsSys, "Registry files, Maildir queues, session JSONL");
tests.uses(ext, "Tests extension modules");
tests.uses(lib, "Tests library layer");

// Component level — index.ts orchestrator
cIndex.uses(cRegistry, "register, unregister, setStatus, updateModel, setTask, setName, getRecord");
cIndex.uses(cMessaging, "init, drainInbox, dispose");
cIndex.uses(cSpawner, "shutdownAll");
cIndex.uses(cUi, "start, stop");

// Component level — messaging
cMessaging.uses(cRegistry, "getRecord, readAllPeers, updatePendingMessages");
cMessaging.uses(cTransport, "send, receive, ack, init, prune, pendingCount, cleanup");
cMessaging.uses(cAgentReg, "onAgentCleanup (returns dispose fn)");

// Component level — peek
cPeek.uses(cRegistry, "readAllPeers, selfId, formatAge, STATUS_SYMBOL");
cPeek.uses(cSessionLog, "readSessionLog, formatSessionLog");

// Component level — ui
cUi.uses(cRegistry, "readAllPeers, getRecord, setName, nameTaken, sortRecords, formatAge, STATUS_SYMBOL");
cUi.uses(cSessionLog, "readSessionLog");

// Component level — registry impl
cRegistry.uses(cAgentReg, "REGISTRY_DIR, STALE_MS, isPidAlive, ensureRegistryDir, runAgentCleanup");

// Component level — lib internal
cMaildir.uses(cTransport, "implements MessageTransport");
cMaildir.uses(cAgentReg, "REGISTRY_DIR");

// Component level — types re-exports
cTypes.uses(cAgentReg, "re-exports AgentRecord, AgentStatus");
cTypes.uses(cToolResult, "re-exports ok, fail, ToolResult");

// ── Helpers ─────────────────────────────────────────────────────

const safeId = (id: string) => `id_${id}`;

// ── Level 1: System Context ────────────────────────────────────

function generateContextDiagram(): string {
	let output = "```mermaid\nC4Context\n";
	output += "    title System Context — tools-and-skills\n\n";

	for (const p of model.people) {
		output += `    Person(${safeId(p.id)}, "${p.name}", "${p.description}")\n`;
	}
	output += "\n";

	for (const s of model.softwareSystems) {
		if (s.name === "Pi Coding Agent") {
			output += `    System(${safeId(s.id)}, "${s.name}", "${s.description}")\n`;
		} else {
			output += `    System_Ext(${safeId(s.id)}, "${s.name}", "${s.description}")\n`;
		}
	}
	output += "\n";

	for (const r of model.relationships) {
		if (r.source.constructor.name !== "Container" && r.destination.constructor.name !== "Container"
			&& r.source.constructor.name !== "Component" && r.destination.constructor.name !== "Component") {
			output += `    Rel(${safeId(r.source.id)}, ${safeId(r.destination.id)}, "${r.description}")\n`;
		}
	}

	output += "```";
	return output;
}

// ── Level 2: Container ─────────────────────────────────────────

function generateContainerDiagram(): string {
	let output = "```mermaid\nC4Container\n";
	output += "    title Container — tools-and-skills repo\n\n";

	for (const p of model.people) {
		output += `    Person(${safeId(p.id)}, "${p.name}", "${p.description}")\n`;
	}
	output += "\n";

	output += `    System_Boundary(repo, "${pi.name}") {\n`;
	for (const c of pi.containers) {
		output += `        Container(${safeId(c.id)}, "${c.name}", "${c.technology}", "${c.description}")\n`;
	}
	output += "    }\n\n";

	for (const s of model.softwareSystems) {
		if (s !== pi) {
			output += `    System_Ext(${safeId(s.id)}, "${s.name}", "${s.description}")\n`;
		}
	}
	output += "\n";

	// Container-level relationships only
	for (const r of model.relationships) {
		const srcType = r.source.constructor.name;
		const dstType = r.destination.constructor.name;
		// Skip component-level and system→system relationships
		if (srcType === "Component" || dstType === "Component") continue;
		if (srcType === "SoftwareSystem" && dstType === "SoftwareSystem") continue;
		// Skip relationships targeting the pi system (it's a boundary, not a node)
		if (r.destination === pi || r.source === pi) continue;
		output += `    Rel(${safeId(r.source.id)}, ${safeId(r.destination.id)}, "${r.description}")\n`;
	}
	// Developer interacts with the extension container directly
	output += `    Rel(${safeId(dev.id)}, ${safeId(ext.id)}, "Prompts, commands, /alias, /agents")\n`;
	// Extension calls LLM (rolled up from system-level pi→llm)
	output += `    Rel(${safeId(ext.id)}, ${safeId(llm.id)}, "API calls (chat completions)")\n`;

	output += "```";
	return output;
}

// ── Level 3: Component ─────────────────────────────────────────

function generateComponentDiagram(): string {
	let output = "```mermaid\nC4Component\n";
	output += '    title Component — extensions/pi-panopticon/\n\n';

	output += '    Container_Boundary(ext, "pi-panopticon extension") {\n';
	for (const c of ext.components) {
		const tech = (c as unknown as { technology?: string }).technology ?? "";
		output += `        Component(${safeId(c.id)}, "${c.name}", "${tech}", "${c.description}")\n`;
	}
	output += "    }\n\n";

	output += '    Container_Boundary(lib, "lib/") {\n';
	for (const c of lib.components) {
		const tech = (c as unknown as { technology?: string }).technology ?? "";
		output += `        Component(${safeId(c.id)}, "${c.name}", "${tech}", "${c.description}")\n`;
	}
	output += "    }\n\n";

	// Component-level relationships only
	for (const r of model.relationships) {
		const srcType = r.source.constructor.name;
		const dstType = r.destination.constructor.name;
		if (srcType === "Component" && dstType === "Component") {
			output += `    Rel(${safeId(r.source.id)}, ${safeId(r.destination.id)}, "${r.description}")\n`;
		}
	}

	output += "```";
	return output;
}

// ── Level 4: Code (class + dependency diagrams) ────────────────

function generateCodeDiagrams(): string {
	const libClasses = `\`\`\`mermaid
classDiagram
    class AgentStatus {
        <<enumeration>>
        running
        waiting
        done
        blocked
        stalled
        terminated
        unknown
    }

    class AgentRecord {
        +id: string
        +name: string
        +pid: number
        +cwd: string
        +model: string
        +startedAt: number
        +heartbeat: number
        +status: AgentStatus
        +task?: string
        +pendingMessages?: number
        +sessionDir?: string
        +sessionFile?: string
    }

    class DeliveryResult {
        +accepted: boolean
        +immediate: boolean
        +reference?: string
        +error?: string
    }

    class InboundMessage {
        +id: string
        +from: string
        +text: string
        +ts: number
    }

    class MessageTransport {
        <<interface>>
        +send(peer, from, msg) Promise~DeliveryResult~
        +receive(agentId) InboundMessage[]
        +ack(agentId, msgId) void
        +prune(agentId) void
        +init(agentId) void
        +pendingCount(agentId) number
        +cleanup(agentId) void
    }

    class MaildirTransport {
        +send(peer, from, msg) Promise~DeliveryResult~
        +receive(agentId) InboundMessage[]
        +ack(agentId, msgId) void
        +prune(agentId) void
        +init(agentId) void
        +pendingCount(agentId) number
        +cleanup(agentId) void
    }

    AgentRecord --> AgentStatus
    MessageTransport --> DeliveryResult : returns
    MessageTransport --> InboundMessage : returns
    MessageTransport --> AgentRecord : receives peer
    MessageTransport <|.. MaildirTransport : implements
\`\`\``;

	const extClasses = `\`\`\`mermaid
classDiagram
    class Registry {
        <<interface>>
        +selfId: string
        +getRecord() Readonly~AgentRecord~ | undefined
        +register(ctx: ExtensionContext) void
        +unregister() void
        +setStatus(status: AgentStatus) void
        +updateModel(model: string) void
        +setTask(task: string) void
        +setName(name: string) void
        +updatePendingMessages(count: number) void
        +readAllPeers() AgentRecord[]
        +flush() void
    }

    class RegistryImpl {
        -record: AgentRecord | undefined
        -heartbeatTimer: Timer | null
        +selfId: string
        +register(ctx) void
        +unregister() void
        +setStatus(status) void
        +updateModel(model) void
        +setTask(task) void
        +setName(name) void
        +updatePendingMessages(count) void
        +flush() void
        +readAllPeers() AgentRecord[]
        -heartbeat() void
    }

    class MessagingModule {
        <<interface>>
        +init() void
        +drainInbox() void
        +dispose() void
    }

    class SpawnerModule {
        <<interface>>
        +shutdownAll() Promise~void~
    }

    class UIModule {
        <<interface>>
        +start(ctx: ExtensionContext) void
        +stop() void
        +refresh(ctx: ExtensionContext) void
    }

    class Orchestrator {
        <<index.ts>>
        -registry: RegistryImpl
        -messaging: MessagingModule
        -spawner: SpawnerModule
        -ui: UIModule
    }

    Registry <|.. RegistryImpl : implements
    RegistryImpl --> "1" AgentRecord : holds (self)
    RegistryImpl --> "0..*" AgentRecord : reads (peers)

    Orchestrator --> RegistryImpl
    Orchestrator --> MessagingModule
    Orchestrator --> SpawnerModule
    Orchestrator --> UIModule

    MessagingModule --> Registry : getRecord, readAllPeers, updatePendingMessages
    MessagingModule --> MessageTransport : send, receive, ack, init, prune, pendingCount, cleanup
    UIModule --> Registry : readAllPeers, getRecord, setName
\`\`\``;

	// Dependency graph generated from component relationships
	let depGraph = "```mermaid\ngraph TD\n";
	depGraph += '    subgraph "pi-panopticon extension"\n';
	for (const c of ext.components) {
		const label = c.name.replace(".ts", "");
		depGraph += `        ${safeId(c.id)}[${label}]\n`;
	}
	depGraph += "    end\n\n";
	depGraph += '    subgraph "lib"\n';
	for (const c of lib.components) {
		const label = c.name.replace(".ts", "").replace("transports/", "transports/");
		depGraph += `        ${safeId(c.id)}[${label}]\n`;
	}
	depGraph += "    end\n\n";

	for (const r of model.relationships) {
		if (r.source.constructor.name === "Component" && r.destination.constructor.name === "Component") {
			depGraph += `    ${safeId(r.source.id)} --> ${safeId(r.destination.id)}\n`;
		}
	}
	depGraph += "```";

	return `### Core types (lib/)\n\n${libClasses}\n\n### Extension modules (pi-panopticon/)\n\n${extClasses}\n\n### Dependency direction\n\n${depGraph}`;
}

// ── Inject into docs ────────────────────────────────────────────

function inject(filePath: string, tag: string, content: string): void {
	const fullPath = path.join(process.cwd(), filePath);
	let doc = fs.readFileSync(fullPath, "utf-8");
	const regex = new RegExp(`<!-- c4-auto-start: ${tag} -->[\\s\\S]*?<!-- c4-auto-end: ${tag} -->`);
	doc = doc.replace(regex, `<!-- c4-auto-start: ${tag} -->\n${content}\n<!-- c4-auto-end: ${tag} -->`);
	fs.writeFileSync(fullPath, doc);
}

inject("docs/C4-Context.md", "context", generateContextDiagram());
inject("docs/C4-Container.md", "container", generateContainerDiagram());
inject("docs/C4-Component.md", "component", generateComponentDiagram());
inject("docs/C4-Code.md", "code", generateCodeDiagrams());

console.log("Generated and injected C4 diagrams: Context, Container, Component, Code");

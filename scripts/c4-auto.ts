import { Workspace } from "structurizr-typescript";
import * as fs from "fs";
import * as path from "path";

// 1. Create a Workspace and Model
const workspace = new Workspace("Tools and Skills", "Architecture Model for the Pi Agent infrastructure");
const model = workspace.model;

// 2. Define Elements
const dev = model.addPerson("Developer", "Uses pi CLI interactively");

const pi = model.addSoftwareSystem("Pi Coding Agent", "CLI + LLM agent loop. Loads extensions, skills, prompts.");
const ext = pi.addContainer("pi-jb-agents", "TypeScript, Pi Extension", "Unified agent infrastructure: registry, messaging, spawning, monitoring");
const lib = pi.addContainer("lib/", "TypeScript", "Shared interfaces and IO");
const skills = pi.addContainer("skills/", "Markdown + scripts", "5 specialized agent skills: planning, research, red-team, weather, skill-creator");
const prompts = pi.addContainer("prompts/", "Markdown", "Prompt templates: refactor, commit-and-push");
const tests = pi.addContainer("tests/", "Vitest", "102 tests: registry, messaging, spawner, lifecycle, maildir");

const llm = model.addSoftwareSystem("LLM Provider", "Anthropic, OpenAI, etc.");
const fsSys = model.addSoftwareSystem("Shared Filesystem", "~/.pi/agents/ registry, Maildir queues, session JSONL");

// 3. Define Relationships
dev.uses(pi, "Prompts, commands, /alias, /agents");
pi.uses(llm, "API calls (chat completions)");
pi.uses(fsSys, "Reads/writes agent records, messages, session logs");

ext.uses(lib, "Imports types, IO, transports");
ext.uses(fsSys, "Registry files, Maildir queues, sockets");
// pi.uses(ext, "Auto-discovers and loads"); // Removed parent->child relationship
// pi.uses(skills, "Loads skill definitions"); // Removed parent->child relationship
// pi.uses(prompts, "Loads prompt templates"); // Removed parent->child relationship
tests.uses(ext, "Tests extension modules");
tests.uses(lib, "Tests library layer");

// Helper to make safe IDs
const safeId = (id: string) => `id_${id}`;

// 4. Generate Level 1 (Context)
function generateContextDiagram(): string {
    let output = "```mermaid\nC4Context\n";
    output += `    title System Context — tools-and-skills\n\n`;

    model.people.forEach(p => {
        output += `    Person(${safeId(p.id)}, "${p.name}", "${p.description}")\n`;
    });

    output += "\n";

    model.softwareSystems.forEach(s => {
        if (s.name === "Pi Coding Agent") {
            output += `    System(${safeId(s.id)}, "${s.name}", "${s.description}")\n`;
        } else {
            output += `    System_Ext(${safeId(s.id)}, "${s.name}", "${s.description}")\n`;
        }
    });

    output += "\n";

    model.relationships.forEach(r => {
        // Roll-up to System level automatically!
        if (r.source.constructor.name !== "Container" && r.destination.constructor.name !== "Container") {
             output += `    Rel(${safeId(r.source.id)}, ${safeId(r.destination.id)}, "${r.description}")\n`;
        }
    });

    output += "```";
    return output;
}

// 5. Generate Level 2 (Container)
function generateContainerDiagram(): string {
    let output = "```mermaid\nC4Container\n";
    output += `    title Container — tools-and-skills repo\n\n`;

    model.people.forEach(p => {
        output += `    Person(${safeId(p.id)}, "${p.name}", "${p.description}")\n`;
    });

    output += "\n";

    output += `    System_Boundary(repo, "${pi.name}") {\n`;
    pi.containers.forEach(c => {
        output += `        Container(${safeId(c.id)}, "${c.name}", "${c.technology}", "${c.description}")\n`;
    });
    output += `    }\n\n`;

    model.softwareSystems.forEach(s => {
        if (s.name !== "Pi Coding Agent") {
            output += `    System_Ext(${safeId(s.id)}, "${s.name}", "${s.description}")\n`;
        }
    });

    output += "\n";

    // We only want relationships that apply at the container level or between systems/people and containers
    model.relationships.forEach(r => {
        const sourceId = safeId(r.source.id);
        const destId = safeId(r.destination.id);
        
        // Skip System -> System relationships if we are showing Container -> System
        if (r.source === pi && r.destination === llm) {
            output += `    Rel(${safeId(dev.id)}, ${safeId(pi.id)}, "Uses")\n`; // Simplified dev -> pi
            return;
        }

        // Just output all generated relationships for containers (Structurizr rolls these up/down logically)
        // For strict C4 we filter, but in our POC we output them directly:
        // Actually, structurizr creates implicit relationships. We can iterate over them.
        if (r.source === dev && r.destination === pi) return; // Replaced manually above
        if (r.source === pi) return; // Skip System -> Container relationships since we want Container -> Container/Ext
        
        output += `    Rel(${sourceId}, ${destId}, "${r.description}")\n`;
    });

    // Add manual Dev -> Pi relationship for the container view
    output += `    Rel(${safeId(dev.id)}, ${safeId(pi.id)}, "Uses")\n`;

    output += "```";
    return output;
}

// 6. Inject into docs
const contextDocPath = path.join(process.cwd(), "docs/C4-Context.md");
let contextDocContent = fs.readFileSync(contextDocPath, "utf-8");

contextDocContent = contextDocContent.replace(
    /<!-- c4-auto-start: context -->[\s\S]*?<!-- c4-auto-end: context -->/,
    `<!-- c4-auto-start: context -->\n${generateContextDiagram()}\n<!-- c4-auto-end: context -->`
);

fs.writeFileSync(contextDocPath, contextDocContent);

const containerDocPath = path.join(process.cwd(), "docs/C4-Container.md");
let containerDocContent = fs.readFileSync(containerDocPath, "utf-8");

containerDocContent = containerDocContent.replace(
    /<!-- c4-auto-start: container -->[\s\S]*?<!-- c4-auto-end: container -->/,
    `<!-- c4-auto-start: container -->\n${generateContainerDiagram()}\n<!-- c4-auto-end: container -->`
);

fs.writeFileSync(containerDocPath, containerDocContent);

console.log("Successfully generated and injected C4 diagrams into docs/C4-Context.md and docs/C4-Container.md!");

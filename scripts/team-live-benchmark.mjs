#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
	OPT_IN_ENV,
	DEFAULT_PROMPT,
	categorizeError,
	isDegraded,
	judgeNode,
	resultIsValid,
	summarize,
} from "./team-live-benchmark-helpers.mjs";

const MAX_CAPTURE_BYTES = 1_000_000;

function fail(message) {
	console.error(message);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { profile: "balanced", runs: 10 };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (
			flag === "--team" ||
			flag === "--profile" ||
			flag === "--runs" ||
			flag === "--output" ||
			flag === "--model"
		) {
			if (value === undefined) fail(`${flag} requires a value`);
			options[flag.slice(2)] = flag === "--runs" ? Number(value) : value;
			index += 1;
		} else {
			fail(`unknown argument: ${flag}`);
		}
	}
	if (options.team !== "fusion-analysis" && options.team !== "navigator")
		fail("--team must be fusion-analysis or navigator");
	if (!["fast", "balanced", "thorough"].includes(options.profile))
		fail("--profile must be fast, balanced, or thorough");
	if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100)
		fail("--runs must be an integer from 1 to 100");
	if (typeof options.output !== "string" || options.output.length === 0)
		fail("--output is required");
	return options;
}

function capture(stream) {
	let bytes = 0;
	stream.on("data", (chunk) => {
		bytes += chunk.length;
		if (bytes > MAX_CAPTURE_BYTES) stream.destroy();
	});
}

function run(command, args) {
	return new Promise((resolveRun) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		capture(child.stdout);
		capture(child.stderr);
		child.on("error", () => resolveRun(127));
		child.on("close", (code) => resolveRun(code ?? 1));
	});
}

async function commandVersion(command, args) {
	return new Promise((resolveVersion) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
		let output = "";
		child.stdout.on("data", (chunk) => {
			if (output.length < 200) output += chunk.toString("utf8");
		});
		child.on("error", () => resolveVersion("unavailable"));
		child.on("close", () =>
			resolveVersion(output.trim().slice(0, 100) || "unavailable"),
		);
	});
}

async function readEvents(sessionPath) {
	try {
		const text = await readFile(sessionPath, "utf-8");
		const events = [];
		for (const line of text.split("\n")) {
			if (line.trim().length === 0) continue;
			try {
				const entry = JSON.parse(line);
				if (
					entry?.customType === "pi-teams:run" &&
					typeof entry.data === "object" &&
					entry.data !== null
				)
					events.push(entry.data);
			} catch {
				// Ignore non-JSON diagnostic lines; no raw session content is retained.
			}
		}
		return events;
	} catch {
		return [];
	}
}

async function main() {
	if (process.env[OPT_IN_ENV] !== "1")
		fail(`${OPT_IN_ENV}=1 is required; live benchmarks never run implicitly`);
	const options = parseArgs(process.argv.slice(2));
	const tempDirectory = await mkdtemp(
		resolve(tmpdir(), "pi-team-live-benchmark-"),
	);
	const commit = await commandVersion("git", ["rev-parse", "HEAD"]);
	const piVersion = await commandVersion("pi", ["--version"]);
	const runs = [];
	try {
		for (let index = 0; index < options.runs; index += 1) {
			const sessionPath = resolve(tempDirectory, `run-${index + 1}.jsonl`);
			const invocation = `Call team_run exactly once with id=${JSON.stringify(options.team)}, profile=${JSON.stringify(options.profile)}, and prompt=${JSON.stringify(DEFAULT_PROMPT)}. Return only the team result.`;
			const args = [
				"--mode",
				"json",
				"--print",
				"--session",
				sessionPath,
				"--no-context-files",
				"--no-skills",
				"--no-prompt-templates",
				"--tools",
				"team_run",
			];
			if (typeof options.model === "string")
				args.push("--model", options.model);
			args.push(invocation);
			const startedAt = Date.now();
			const exitCode = await run("pi", args);
			const endToEndDurationMs = Date.now() - startedAt;
			const events = await readEvents(sessionPath);
			const startedEvents = events.filter(
				(event) => event.kind === "run_started",
			);
			const startedEvent =
				startedEvents.length === 1 && startedEvents[0]?.teamId === options.team
					? startedEvents[0]
					: undefined;
			const routingValid = startedEvent !== undefined;
			const completedEvents = routingValid
				? events.filter(
						(event) =>
							event.kind === "run_completed" &&
							event.runId === startedEvent.runId,
					)
				: [];
			const completedEvent =
				completedEvents.length === 1 ? completedEvents[0] : undefined;
			const nodes = events
				.filter(
					(event) =>
						event.kind === "node_completed" &&
						event.runId === startedEvent?.runId,
				)
				.map((event) => ({
					role: String(event.role ?? "unknown"),
					model: String(event.model ?? "unknown"),
					ok: event.ok === true,
					durationMs: Number(event.durationMs) || 0,
					...(typeof event.error === "string" && event.error.length > 0
						? { errorCategory: categorizeError(event.error) }
						: {}),
				}));
			const schemaValid =
				routingValid && resultIsValid(options.team, completedEvent);
			const degraded =
				routingValid && isDegraded(options.team, nodes, completedEvent);
			const judge = judgeNode(nodes);
			const judgeValid =
				options.team === "fusion-analysis"
					? Boolean(judge?.ok && schemaValid)
					: schemaValid;
			runs.push({
				index: index + 1,
				exitCode,
				endToEndDurationMs,
				routingValid,
				teamDurationMs:
					typeof completedEvent?.durationMs === "number"
						? completedEvent.durationMs
						: null,
				schemaValid,
				judgeValid,
				degraded,
				resultValid: schemaValid && !degraded,
				failureCategory:
					exitCode !== 0
						? "pi_process_failed"
						: !routingValid
							? "team_routing_invalid"
							: completedEvent === undefined
								? "team_completion_missing_or_duplicate"
								: !schemaValid
									? "invalid_result"
									: degraded
										? "degraded"
										: null,
				nodes,
			});
		}
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
	const report = {
		schemaVersion: 2,
		generatedAt: new Date().toISOString(),
		repositoryCommit: commit,
		piVersion,
		nodeVersion: process.version,
		platform: `${process.platform}-${process.arch}`,
		team: options.team,
		profile: options.profile,
		runCount: options.runs,
		...(typeof options.model === "string" ? { outerModel: options.model } : {}),
		promptId: createHash("sha256")
			.update(DEFAULT_PROMPT)
			.digest("hex")
			.slice(0, 16),
		runs,
		summary: summarize(runs, options.team),
	};
	const outputPath = resolve(options.output);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
		mode: 0o600,
	});
	console.log(`wrote redacted benchmark metrics to ${outputPath}`);
}

await main();
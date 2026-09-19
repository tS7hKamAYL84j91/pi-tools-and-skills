/**
 * Gated fleet control (v1 roadmap item 2, ported from the Python host):
 * stand-up / stand-down.
 *
 * The service runs the same `make eo-agent-add` / `make eo-agent-remove`
 * commands Q uses (cwd: the coas repo). Flow: dry-run preview (DRY_RUN=1) ->
 * Jim confirms in the UI -> execute (APPLY=1) -> append-only audit entry in
 * control/audit.jsonl. Gravitas/Q watch that log for control events.
 *
 * Safety properties (must hold in every future change):
 * - No free-form client input: action + fleet key select a server-built
 *   command from the standup/standdown tables below; the subprocess argv is
 *   fully controlled (execFile, no shell).
 * - Execute requires a single-use preview token bound to the same
 *   action + key, valid PREVIEW_TTL_SECONDS (10 min). No token, no execute.
 * - The manager commands themselves refuse live mutation without the
 *   dry-run gate and preserve repos/session history (non-destructive).
 * - A failed preview never issues an execute token.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendLogLine } from "../lib/file-persistence.js";
import { FLEET_HOME } from "./config.js";

export const PREVIEW_TTL_SECONDS = 600;
export const RUN_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL = 4000;
const LOG_LIMIT = 10;

/** Invalid control request (maps to HTTP 400). */
export class ControlError extends Error {}
/** The control audit log is a contract: an un-audited execute fails hard (500). */
export class AuditWriteError extends Error {}

export type ControlActionName = "standup" | "standdown";

export interface MakeResult {
	readonly output: string;
	readonly exitCode: number;
	readonly error: string;
}

export type MakeRunner = (args: string[]) => Promise<MakeResult>;

export interface ControlSpec {
	readonly key: string;
	readonly display: string;
	readonly state: string;
	readonly action: ControlActionName;
	readonly manifest: string;
	readonly note: string;
}

export interface AuditEntry {
	readonly ts: string;
	readonly requestId: string;
	readonly action: string;
	readonly key: string;
	readonly manifest: string;
	readonly command: string;
	readonly exitCode: number;
	readonly output: string;
	readonly requester: string;
}

export interface ControlState {
	readonly specs: ControlSpec[];
	readonly log: AuditEntry[];
}

export interface ControlOptions {
	/** cwd for the make invocation (the coas repo). */
	readonly coasDir?: string;
	/** directory holding audit.jsonl. */
	readonly controlDir?: string;
	/** injectable make runner — tests never touch the coas repo. */
	readonly runner?: MakeRunner;
	/** injectable clock for token-expiry tests. */
	readonly now?: () => number;
}

interface StandupSpec {
	readonly manifest: string;
	readonly repo: string;
	readonly profile: string;
	readonly modelEnv?: string;
	readonly defaultModel?: string;
	readonly note: string;
}

// Fleet membership changes remain Jim's decision — the dashboard only gates
// them behind dry-run preview + explicit confirm. Mirror of eo_fleet/config.py.
const COAS_DIR = join(homedir(), "git", "coas");

// Live agents eligible for stand-down: fleet key -> manifest name.
const CONTROL_STANDDOWN: Readonly<Record<string, string>> = {
	gravitas: "gravitas",
	coas: "quartermaster",
	"pi-tools-and-skills": "pi-tools-and-skills",
	"casmi-gm": "kaggle-enveda-casmi26-gm",
	"eo-fleet-overview": "eo-fleet-overview-gm",
};

// Stood-down agents eligible for stand-up, with the exact spec recorded when
// they were live. Revival is a Jim decision.
const CONTROL_STANDUP: Readonly<Record<string, StandupSpec>> = {
	"titanic-gm": {
		manifest: "kaggle-spaceship-titanic-gm",
		repo: "../kaggle-spaceship-titanic",
		profile: "general-manager",
		modelEnv: "COAS_KAGGLE_SPACESHIP_TITANIC_GM_MODEL",
		defaultModel: "openai-codex/gpt-5.5",
		note: "Stood down 2026-09-16 per Jim. make-based re-add does not restore the startupPrompt wiring (coas commit 8b9c930) — Q re-wires it after stand-up.",
	},
};

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
	gravitas: "Gravitas (chief-of-staff)",
	coas: "Q (coas)",
	"pi-tools-and-skills": "pi-tools-and-skills",
	"casmi-gm": "casmi-gm (enveda CASMI26)",
	"eo-fleet-overview": "eo-fleet-overview-gm (this dashboard)",
	"titanic-gm": "titanic-gm (stood down)",
};

interface PreviewRecord {
	readonly action: ControlActionName;
	readonly key: string;
	readonly args: string[];
	readonly issuedAt: number;
}

function nowStamp(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function display(args: string[]): string {
	return `make ${args.join(" ")}`;
}

function tail(text: string): string {
	return text.length > OUTPUT_TAIL ? text.slice(-OUTPUT_TAIL) : text;
}

function combineOutput(stdout: string, stderr: string): string {
	const out = stdout.trim();
	const err = stderr.trim();
	return err ? `${out}\n[stderr]\n${err}`.trim() : out;
}

function execFileAsync(
	binary: string,
	args: string[],
	options: { cwd: string; timeout: number; maxBuffer: number },
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(binary, args, options, (error, stdout, stderr) => {
			if (error) {
				const withOutput = error as NodeJS.ErrnoException & {
					stdout?: string;
					stderr?: string;
					killed?: boolean;
					signal?: NodeJS.Signals;
					code?: string | number;
				};
				if (typeof withOutput.code === "number") {
					reject(
						Object.assign(new Error(`exit ${withOutput.code}`), {
							code: withOutput.code,
							stdout: String(stdout ?? ""),
							stderr: String(stderr ?? ""),
						}),
					);
				} else if (withOutput.code === "ENOENT") {
					reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
				} else {
					reject(
						Object.assign(new Error("killed by signal"), {
							code: withOutput.signal ?? "killed",
							killed: true,
							stdout: String(stdout ?? ""),
							stderr: String(stderr ?? ""),
						}),
					);
				}
			} else {
				resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
			}
		});
	});
}

/** Run a make target in the coas repo (execFile: no shell; fully controlled argv). */
async function runMake(args: string[], coasDir: string): Promise<MakeResult> {
	try {
		const { stdout, stderr } = await execFileAsync("make", args, {
			cwd: coasDir,
			timeout: RUN_TIMEOUT_SECONDS * 1000,
			maxBuffer: 4 * 1024 * 1024,
		});
		return { output: combineOutput(stdout, stderr), exitCode: 0, error: "" };
	} catch (raw) {
		const error = raw as NodeJS.ErrnoException & {
			stdout?: string;
			stderr?: string;
			killed?: boolean;
			code?: string | number;
		};
		if (error.code === "ENOENT") {
			return {
				output: "make not found on PATH",
				exitCode: 127,
				error: "make-missing",
			};
		}
		if (error.killed || typeof error.code === "string") {
			return {
				output: `command timed out after ${RUN_TIMEOUT_SECONDS}s`,
				exitCode: 124,
				error: "timeout",
			};
		}
		return {
			output: combineOutput(
				String(error.stdout ?? ""),
				String(error.stderr ?? ""),
			),
			exitCode: typeof error.code === "number" ? error.code : 1,
			error: "",
		};
	}
}

export interface Control {
	preview(action: string, key: string): Promise<Record<string, unknown>>;
	execute(
		requestId: string,
		action: string,
		key: string,
	): Promise<Record<string, unknown>>;
	controlState(): Promise<ControlState>;
}

/** Build a control instance. server.ts uses the defaults; tests inject fakes. */
export function createControl(options: ControlOptions = {}): Control {
	const coasDir = options.coasDir ?? COAS_DIR;
	const controlDir = options.controlDir ?? join(FLEET_HOME, "control");
	const auditPath = join(controlDir, "audit.jsonl");
	const runner: MakeRunner =
		options.runner ?? ((args) => runMake(args, coasDir));
	const now: () => number = options.now ?? (() => Date.now());

	// Single-use preview tokens: requestId -> preview record.
	const previews = new Map<string, PreviewRecord>();

	function resolveSpec(
		action: string,
		key: string,
	): { manifest: string; note: string } {
		if (action === "standdown") {
			const manifest = CONTROL_STANDDOWN[key];
			if (!manifest) {
				throw new ControlError(`no stand-down target for '${key}'`);
			}
			return { manifest, note: "" };
		}
		if (action === "standup") {
			const spec = CONTROL_STANDUP[key];
			if (!spec) {
				throw new ControlError(`no stand-up spec for '${key}'`);
			}
			return { manifest: spec.manifest, note: spec.note };
		}
		throw new ControlError(`unknown action '${action}'`);
	}

	function previewArgs(action: ControlActionName, key: string): string[] {
		const spec = resolveSpec(action, key);
		if (action === "standdown") {
			return ["eo-agent-remove", `NAME=${spec.manifest}`, "DRY_RUN=1"];
		}
		const up = CONTROL_STANDUP[key];
		if (!up) throw new ControlError(`no stand-up spec for '${key}'`);
		const args = [
			"eo-agent-add",
			`NAME=${up.manifest}`,
			`REPO=${up.repo}`,
			`PROFILE=${up.profile}`,
		];
		if (up.modelEnv) args.push(`MODEL_ENV=${up.modelEnv}`);
		if (up.defaultModel) args.push(`DEFAULT_MODEL=${up.defaultModel}`);
		args.push("DRY_RUN=1");
		return args;
	}

	function applyArgs(preview: string[]): string[] {
		return preview.filter((arg) => arg !== "DRY_RUN=1").concat(["APPLY=1"]);
	}

	function gcPreviews(): void {
		for (const [id, record] of previews) {
			if (now() - record.issuedAt > PREVIEW_TTL_SECONDS) {
				previews.delete(id);
			}
		}
	}

	return {
		async preview(
			action: string,
			key: string,
		): Promise<Record<string, unknown>> {
			const args = previewArgs(action as ControlActionName, key);
			const spec = resolveSpec(action, key);
			const result = await runner(args);
			const response = {
				action,
				key,
				manifest: spec.manifest,
				note: spec.note,
				command: display(args),
				output: tail(result.output),
				exitCode: result.exitCode,
			};
			if (result.exitCode !== 0) {
				// never issue an execute token for a failed preview
				return { ok: false, ...response };
			}
			const requestId = randomUUID().replace(/-/g, "");
			previews.set(requestId, {
				action: action as ControlActionName,
				key,
				args,
				issuedAt: now(),
			});
			gcPreviews();
			return {
				ok: true,
				requestId,
				expiresInSeconds: PREVIEW_TTL_SECONDS,
				...response,
			};
		},

		async execute(
			requestId: string,
			action: string,
			key: string,
		): Promise<Record<string, unknown>> {
			const record = previews.get(requestId);
			if (!record) {
				throw new ControlError(
					"unknown or already-used preview — run the preview again",
				);
			}
			if (now() - record.issuedAt > PREVIEW_TTL_SECONDS) {
				previews.delete(requestId);
				throw new ControlError("preview expired — run the preview again");
			}
			if (record.action !== action || record.key !== key) {
				// mismatch must NOT consume the token
				throw new ControlError(
					"preview token does not match this action/agent",
				);
			}
			const args = applyArgs(record.args);
			previews.delete(requestId); // single use, whatever the outcome
			const result = await runner(args);
			const entry: AuditEntry = {
				ts: nowStamp(),
				requestId,
				action,
				key,
				manifest: resolveSpec(action, key).manifest,
				command: display(args),
				exitCode: result.exitCode,
				output: tail(result.output),
				requester: "jim (fleet dashboard)",
			};
			try {
				await appendLogLine(auditPath, JSON.stringify(entry));
			} catch (cause) {
				throw new AuditWriteError(
					cause instanceof Error ? cause.message : String(cause),
					{ cause },
				);
			}
			return {
				ok: result.exitCode === 0,
				audited: true,
				output: result.output,
				exitCode: result.exitCode,
				error: result.error,
			};
		},

		async controlState(): Promise<ControlState> {
			const specs: ControlSpec[] = [];
			for (const [key, manifest] of Object.entries(CONTROL_STANDDOWN)) {
				specs.push({
					key,
					display: DISPLAY_NAMES[key] ?? key,
					state: "live",
					action: "standdown",
					manifest,
					note: "",
				});
			}
			for (const [key, spec] of Object.entries(CONTROL_STANDUP)) {
				specs.push({
					key,
					display: DISPLAY_NAMES[key] ?? key,
					state: "stood down",
					action: "standup",
					manifest: spec.manifest,
					note: spec.note,
				});
			}
			return { specs, log: await readLog(auditPath, LOG_LIMIT) };
		},
	};
}

/** Newest-first tail of the control audit log (missing file = empty). */
export async function readLog(
	auditPath: string,
	limit: number,
): Promise<AuditEntry[]> {
	let raw: string;
	try {
		raw = await readFile(auditPath, "utf8");
	} catch {
		return [];
	}
	const out: AuditEntry[] = [];
	for (const line of raw.split("\n").reverse()) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const data: unknown = JSON.parse(trimmed);
			if (typeof data === "object" && data !== null && !Array.isArray(data)) {
				out.push(data as AuditEntry);
			}
		} catch {
			// defensive: skip a torn/corrupt line, keep the rest
		}
		if (out.length >= limit) break;
	}
	return out;
}

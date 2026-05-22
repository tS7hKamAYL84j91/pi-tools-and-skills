/** Opt-in local session spool hook installer POC. */

import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

export const SESSION_SPOOL_HOOK_FILENAME = "session-spool-hook.json";
export const SESSION_SPOOL_HOOK_VERSION = 1;

/** @public */
export type SessionHookAction = "status" | "install" | "uninstall" | "dry-run";

/** @public */
export interface SessionHookConfig {
	registryDir: string;
	hookName?: string;
	retentionEvents?: number;
}

/** @public */
export interface SessionHookState {
	version: typeof SESSION_SPOOL_HOOK_VERSION;
	hookName: string;
	registryDir: string;
	retentionEvents: number;
	installedAt: string;
	posture: "local-private-input-redacted-output";
}

/** @public */
export interface SessionHookResult {
	action: SessionHookAction;
	registryDir: string;
	hookPath: string;
	installed: boolean;
	changed: boolean;
	state?: SessionHookState;
}

const MAX_RETENTION_EVENTS = 100;

function isWithin(parent: string, child: string): boolean {
	const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
	return child === parent || child.startsWith(normalizedParent);
}

/** Validate the explicit local registry directory used by the hook POC. */
export async function validateSessionHookConfig(config: SessionHookConfig): Promise<{ registryDir: string; hookPath: string; retentionEvents: number; hookName: string }> {
	if (!config.registryDir) throw new Error("registryDir is required; no implicit default is allowed");
	if (!isAbsolute(config.registryDir)) throw new Error("registryDir must be an absolute local path");
	const registryDir = resolve(config.registryDir);
	const hookPath = resolve(registryDir, SESSION_SPOOL_HOOK_FILENAME);
	if (!isWithin(registryDir, hookPath)) throw new Error("hook path must stay inside registryDir");
	try {
		const stat = await lstat(registryDir);
		if (stat.isSymbolicLink()) throw new Error("registryDir must not be a symlink");
		if (!stat.isDirectory()) throw new Error("registryDir must be a directory");
	} catch (error) {
		if ((error as { code?: string }).code !== "ENOENT") throw error;
	}
	const retentionEvents = config.retentionEvents ?? MAX_RETENTION_EVENTS;
	if (!Number.isInteger(retentionEvents) || retentionEvents < 1 || retentionEvents > MAX_RETENTION_EVENTS) throw new Error(`retentionEvents must be an integer from 1 to ${MAX_RETENTION_EVENTS}`);
	return { registryDir, hookPath, retentionEvents, hookName: config.hookName ?? "session-spool-local" };
}

export async function readSessionHookState(registryDir: string): Promise<SessionHookState | undefined> {
	const resolved = await validateSessionHookConfig({ registryDir });
	return readState(resolved.hookPath);
}

async function readState(hookPath: string): Promise<SessionHookState | undefined> {
	try {
		return JSON.parse(await readFile(hookPath, "utf8")) as SessionHookState;
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return undefined;
		throw error;
	}
}

/** Manage the off-by-default local hook manifest. Does not install global hooks. */
export async function manageSessionSpoolHook(action: SessionHookAction, config: SessionHookConfig): Promise<SessionHookResult> {
	const resolved = await validateSessionHookConfig(config);
	const existing = await readState(resolved.hookPath);
	if (action === "status") {
		return { action, registryDir: resolved.registryDir, hookPath: resolved.hookPath, installed: existing !== undefined, changed: false, ...(existing ? { state: existing } : {}) };
	}
	if (action === "dry-run") {
		const state = buildState(resolved.registryDir, resolved.hookName, resolved.retentionEvents);
		return { action, registryDir: resolved.registryDir, hookPath: resolved.hookPath, installed: existing !== undefined, changed: false, state };
	}
	if (action === "uninstall") {
		if (!existing) return { action, registryDir: resolved.registryDir, hookPath: resolved.hookPath, installed: false, changed: false };
		await rm(resolved.hookPath, { force: true });
		return { action, registryDir: resolved.registryDir, hookPath: resolved.hookPath, installed: false, changed: true };
	}
	await mkdir(resolved.registryDir, { recursive: true });
	const state = existing ?? buildState(resolved.registryDir, resolved.hookName, resolved.retentionEvents);
	if (!existing) await writeFile(resolved.hookPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return { action, registryDir: resolved.registryDir, hookPath: resolved.hookPath, installed: true, changed: !existing, state };
}

function buildState(registryDir: string, hookName: string, retentionEvents: number): SessionHookState {
	return {
		version: SESSION_SPOOL_HOOK_VERSION,
		hookName,
		registryDir,
		retentionEvents,
		installedAt: new Date().toISOString(),
		posture: "local-private-input-redacted-output",
	};
}

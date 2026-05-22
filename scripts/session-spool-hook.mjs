#!/usr/bin/env node
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

const FILE = 'session-spool-hook.json';
const VERSION = 1;
const MAX_RETENTION = 100;

function usage() {
  return `Usage: node scripts/session-spool-hook.mjs <status|install|uninstall|dry-run> --registry-dir <absolute-local-dir> [--retention-events N]\n\nOff-by-default local POC. No global hooks are installed; the command only manages a manifest in the explicit registry dir.`;
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!['status', 'install', 'uninstall', 'dry-run'].includes(action)) throw new Error(usage());
  const out = { action, retentionEvents: MAX_RETENTION };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--registry-dir') out.registryDir = rest[++i];
    else if (arg === '--retention-events') out.retentionEvents = Number.parseInt(rest[++i] ?? '', 10);
    else throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return out;
}

function isWithin(parent, child) {
  const p = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(p);
}

async function validate(config) {
  if (!config.registryDir) throw new Error('registryDir is required; no implicit default is allowed');
  if (!isAbsolute(config.registryDir)) throw new Error('registryDir must be an absolute local path');
  const registryDir = resolve(config.registryDir);
  const hookPath = resolve(registryDir, FILE);
  if (!isWithin(registryDir, hookPath)) throw new Error('hook path must stay inside registryDir');
  try {
    const stat = await lstat(registryDir);
    if (stat.isSymbolicLink()) throw new Error('registryDir must not be a symlink');
    if (!stat.isDirectory()) throw new Error('registryDir must be a directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!Number.isInteger(config.retentionEvents) || config.retentionEvents < 1 || config.retentionEvents > MAX_RETENTION) throw new Error(`retentionEvents must be an integer from 1 to ${MAX_RETENTION}`);
  return { registryDir, hookPath, retentionEvents: config.retentionEvents };
}

async function readState(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function buildState(registryDir, retentionEvents) {
  return { version: VERSION, hookName: 'session-spool-local', registryDir, retentionEvents, installedAt: new Date().toISOString(), posture: 'local-private-input-redacted-output' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await validate(args);
  const existing = await readState(cfg.hookPath);
  let result;
  if (args.action === 'status') result = { action: args.action, registryDir: cfg.registryDir, hookPath: cfg.hookPath, installed: existing !== undefined, changed: false, state: existing };
  else if (args.action === 'dry-run') result = { action: args.action, registryDir: cfg.registryDir, hookPath: cfg.hookPath, installed: existing !== undefined, changed: false, state: buildState(cfg.registryDir, cfg.retentionEvents) };
  else if (args.action === 'uninstall') {
    if (existing) await rm(cfg.hookPath, { force: true });
    result = { action: args.action, registryDir: cfg.registryDir, hookPath: cfg.hookPath, installed: false, changed: existing !== undefined };
  } else {
    await mkdir(cfg.registryDir, { recursive: true });
    const state = existing ?? buildState(cfg.registryDir, cfg.retentionEvents);
    if (!existing) await writeFile(cfg.hookPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    result = { action: args.action, registryDir: cfg.registryDir, hookPath: cfg.hookPath, installed: true, changed: !existing, state };
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

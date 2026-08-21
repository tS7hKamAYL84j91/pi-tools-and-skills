#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'scripts', 'session-hook-installer-cli.ts');
const result = spawnSync('npx', ['tsx', cliPath, ...process.argv.slice(2)], { stdio: 'inherit', cwd: repoRoot });

if (result.error) {
  console.error(result.error instanceof Error ? result.error.message : String(result.error));
  process.exit(1);
}
process.exit(result.status ?? 1);

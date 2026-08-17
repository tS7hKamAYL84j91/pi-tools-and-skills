#!/usr/bin/env node
/**
 * Lightweight Semgrep OSS scan runner for pi-tools-and-skills.
 *
 * Runs custom rules under rules/custom/ against extensions/, lib/, tests/,
 * and scripts/. Exits non-zero when rules report findings.
 *
 * Semgrep must be installed in the environment (e.g. `pip install semgrep`).
 * This script intentionally does not install it automatically.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const configDir = path.join(root, "rules", "custom");
const targets = ["extensions", "lib", "tests", "scripts"];

function main() {
	const semgrep = process.env.SEMGREP_BIN ?? "semgrep";
	const args = [
		"scan",
		"--config",
		configDir,
		"--error",
		"--disable-version-check",
		"--no-rewrite-rule-ids",
		...targets,
	];

	const result = spawnSync(semgrep, args, {
		cwd: root,
		stdio: "inherit",
		shell: false,
	});

	if (result.error) {
		console.error(`Failed to run ${semgrep}: ${result.error.message}`);
		process.exit(1);
	}

	process.exit(result.status ?? 1);
}

main();

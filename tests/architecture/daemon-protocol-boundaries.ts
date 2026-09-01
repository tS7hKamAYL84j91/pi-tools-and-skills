/**
 * Daemon protocol boundary fitness functions (ADR-053): lib/daemon-protocol
 * is the published client-facing surface of the daemon control plane and
 * must never depend on the private systemd-deployed implementation in
 * daemon/src. A published package ships lib/ but not daemon/ (root
 * package.json files whitelist), so any such import would leave consumers
 * with unresolvable modules.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

/** The published protocol surface (ADR-053 decision table), nothing else. */
const EXPECTED_PROTOCOL_MODULES = [
	"lib/daemon-protocol/admission.ts",
	"lib/daemon-protocol/paths.ts",
	"lib/daemon-protocol/registry-event-buffer.ts",
	"lib/daemon-protocol/registry-protocol.ts",
	"lib/daemon-protocol/registry-types.ts",
];

/** Import specifiers in `content` that resolve into daemon/src/. */
function daemonSourceImportSpecifiers(content: string): string[] {
	const importPattern =
		/(?:from|import)\s*\(?["']([^"']*daemon\/src\/[^"']*)["']/g;
	return [...content.matchAll(importPattern)]
		.map((match) => match[1] ?? "")
		.filter(Boolean);
}

describe("daemon protocol boundary (ADR-053)", () => {
	it("lib/daemon-protocol is exactly the published protocol surface", () => {
		const modules = listTsFiles("lib/daemon-protocol")
			.map((file) => relative(process.cwd(), file))
			.sort();
		expect(modules).toEqual([...EXPECTED_PROTOCOL_MODULES].sort());
	});

	it("lib/daemon-protocol never imports the private daemon implementation", () => {
		const violations = listTsFiles("lib/daemon-protocol").flatMap((file) =>
			daemonSourceImportSpecifiers(readFileSync(file, "utf8")).map(
				(specifier) =>
					`${relative(process.cwd(), file)} imports daemon/src via "${specifier}"`,
			),
		);
		expect(violations).toEqual([]);
	});

	it("guard detects a synthetic daemon/src import (self-verification)", () => {
		const synthetic = [
			'import { capabilityProof } from "../../daemon/src/admission.js";',
			'import type { RegistryEntry } from "../../daemon/src/registry.js";',
			'const dynamic = await import("../../daemon/src/paths.js");',
		].join("\n");
		expect(daemonSourceImportSpecifiers(synthetic)).toEqual([
			"../../daemon/src/admission.js",
			"../../daemon/src/registry.js",
			"../../daemon/src/paths.js",
		]);
		// Clean protocol-internal and lib-side imports are never flagged.
		const clean = [
			'import type { RegistryEvent } from "./registry-types.js";',
			'import { socketPath } from "../../lib/daemon-protocol/paths.js";',
		].join("\n");
		expect(daemonSourceImportSpecifiers(clean)).toEqual([]);
	});
});
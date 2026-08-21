/** ADR-047 Boost-only resolver over the shared declarative discovery primitive. */

import { statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverDeclarativeRoots,
	discoverFixedTargets,
} from "../../lib/declarative-discovery.js";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";
import {
	boostDescriptorFingerprint,
	parseBoostDescriptor,
	type BoostDescriptorResolution,
} from "./boost-descriptor.js";

const DEFAULT_BOOST_DESCRIPTOR_PATH = join(
	dirname(fileURLToPath(import.meta.url)), "config", "boost.md",
);

export interface BoostDescriptorAdapter {
	resolve(): Promise<BoostDescriptorResolution | undefined>;
}

interface BoostDescriptorAdapterOptions {
	readonly configPath?: string;
	readonly cwd?: string;
	readonly settingsPath?: string;
	readonly roots?: readonly string[];
	readonly now: () => number;
}

/** Resolves exactly one valid fixed `boost.md` in the highest present layer. */
export function createBoostDescriptorAdapter(
	options: BoostDescriptorAdapterOptions,
): BoostDescriptorAdapter {
	const cwd = options.cwd ?? process.cwd();
	const configPath = options.configPath ?? DEFAULT_BOOST_DESCRIPTOR_PATH;
	return {
		resolve: async () => {
			const roots = discoverDeclarativeRoots({
				configPath,
				settingsKey: "boost",
				readSettingsKey: readPiSettingsKey,
				userSettingsPath: options.settingsPath ?? PI_SETTINGS_PATH,
				userFallbackRoot: join(homedir(), ".pi", "agent", "boost"),
				projectSettingsRelativePath: join(".pi", "settings.json"),
				projectFallbackRoot: join(".pi", "boost"),
				cwd,
				roots: options.roots,
			});
			const targets = discoverFixedTargets(roots, "boost.md");
			for (const source of ["project", "user", "builtin"] as const) {
				const present = targets.filter((target) => target.source === source && isPresent(target.path));
				if (present.length === 0) {
					continue;
				}
				if (present.length !== 1) {
					return undefined;
				}
				const selected = present[0];
				if (!selected) {
					return undefined;
				}
				const descriptor = parseBoostDescriptor(readFileSync(selected.path, "utf8"), options.now());
				return descriptor === undefined ? undefined : {
					descriptor,
					fingerprint: boostDescriptorFingerprint(descriptor),
					source: selected.source,
					path: selected.path,
				};
			}
			return undefined;
		},
	};
}

function isPresent(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

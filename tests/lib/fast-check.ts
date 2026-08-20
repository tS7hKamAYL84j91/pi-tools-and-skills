import type {
	IAsyncProperty,
	IProperty,
	RunDetails,
} from "fast-check";
import fc from "fast-check";

const DEFAULT_FC_SEED = 8_412_026;
const FC_NUM_RUNS = 100;

function readSeed(): number {
	const configuredSeed = process.env.FC_SEED;
	if (configuredSeed === undefined) {
		return DEFAULT_FC_SEED;
	}
	if (!/^-?\d+$/.test(configuredSeed)) {
		throw new Error(`FC_SEED must be an integer: ${configuredSeed}`);
	}
	const seed = Number(configuredSeed);
	if (!Number.isSafeInteger(seed)) {
		throw new Error(`FC_SEED must be a safe integer: ${configuredSeed}`);
	}
	return seed;
}

function reportFailure<T>(details: RunDetails<T>): void {
	if (!details.failed) {
		return;
	}
	const replayPath = details.counterexamplePath ?? "";
	const counterexample = fc.stringify(details.counterexample);
	throw new Error(
		`fast-check failure; replay with FC_SEED=${details.seed} FC_PATH=${replayPath}; counterexample=${counterexample}`,
		{ cause: details.errorInstance },
	);
}

function runParameters() {
	const path = process.env.FC_PATH;
	return {
		seed: readSeed(),
		numRuns: FC_NUM_RUNS,
		...(path === undefined ? {} : { path }),
	};
}

export function assertProperty<T>(property: IProperty<T>): void {
	fc.assert(property, {
		...runParameters(),
		reporter: reportFailure,
	});
}

export async function assertAsyncProperty<T>(
	property: IAsyncProperty<T>,
): Promise<void> {
	await fc.assert(property, {
		...runParameters(),
		asyncReporter: async (details) => reportFailure(details),
	});
}

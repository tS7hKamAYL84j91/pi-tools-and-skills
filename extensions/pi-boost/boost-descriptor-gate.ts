/** Runtime gate joining a selected descriptor to issuer, budget, and reviewed host identity. */

import { hasReviewedBoostModelBinding, type BoostDescriptorResolution, type ReviewedBoostModelResolver } from "./boost-descriptor.js";
import type { BoostDescriptorAdapter } from "./boost-descriptor-adapter.js";
import type { LiveBoostControlReference } from "./live-boost-control-contract.js";

interface DescriptorGateInput {
	readonly descriptor: BoostDescriptorAdapter;
	readonly models: ReviewedBoostModelResolver;
	readonly control: LiveBoostControlReference;
	readonly issuerId: string;
	readonly requestedYields: number;
}

export async function resolveCurrentBoostDescriptor(input: DescriptorGateInput): Promise<BoostDescriptorResolution | undefined> {
	try {
		const resolution = await input.descriptor.resolve();
		if (!resolution || resolution.descriptor.enablementId !== input.control.enablementId ||
			resolution.descriptor.principalIssuerId !== input.issuerId ||
			resolution.descriptor.maximumYields < input.requestedYields ||
			!hasReviewedBoostModelBinding(resolution.descriptor, input.models)) {
			return undefined;
		}
		return resolution;
	} catch {
		return undefined;
	}
}

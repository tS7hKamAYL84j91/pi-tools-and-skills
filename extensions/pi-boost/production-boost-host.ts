/** Production assembly of the reviewed Boost host from injected dependencies. */

import type { BoostGovernanceDecision } from "./boost/contracts.js";
import type { LiveBoostHostInjection } from "./boost/runtime-adapter.js";
import {
	DaemonBoostControlStore,
	type DaemonBoostWal,
} from "./daemon-boost-control-store.js";
import { HostInjectedLiveBoostRuntime } from "./host-injected-live-boost.js";
import type {
	LiveBoostAuditRecord,
	LiveBoostProviderRequest,
	LiveBoostTerminalEvent,
} from "./live-boost-bridge-contract.js";
import {
	createExternalBoostConfigAdapter,
	type ExternalBoostConfigRecordSource,
} from "./external-boost-config-adapter.js";
import type { ExternalBoostConfigReference } from "./external-boost-config-contract.js";
import {
	createReviewedBoostHost,
	type ReviewedBoostContractIdentity,
	type ReviewedBoostHost,
} from "./reviewed-boost-host.js";

/** @public All host-owned dependencies needed to construct the config-bound bridge. */
export interface ProductionBoostHostInput {
	readonly contract: ReviewedBoostContractIdentity;
	readonly control: {
		readonly reference: ExternalBoostConfigReference;
		readonly source: ExternalBoostConfigRecordSource;
		readonly principalIssuerId: string;
	};
	readonly wal: DaemonBoostWal;
	readonly now: () => number;
	readonly nextLeaseId: () => string;
	readonly governance: {
		classify(combinedInput: string): Promise<BoostGovernanceDecision>;
	};
	readonly provider: {
		dispatch(
			request: LiveBoostProviderRequest,
			signal: AbortSignal,
		): Promise<LiveBoostTerminalEvent>;
	};
	readonly baseline: {
		restore(subjectId: string): Promise<void>;
	};
	readonly audit: {
		append(record: LiveBoostAuditRecord): Promise<void>;
	};
	readonly shutdownChoice: LiveBoostHostInjection["shutdownChoice"];
}

/** Opens the durable store and constructs a cold reviewed host without dispatching. */
export async function createProductionBoostHost(
	input: ProductionBoostHostInput,
): Promise<ReviewedBoostHost> {
	const control = createExternalBoostConfigAdapter(input.control.source, {
		principalIssuerId: input.control.principalIssuerId,
		now: input.now,
	});
	const store = await DaemonBoostControlStore.open(input.wal, input.now);
	const bridge = new HostInjectedLiveBoostRuntime({
		store,
		control,
		now: input.now,
		nextLeaseId: input.nextLeaseId,
		governance: input.governance,
		provider: input.provider,
		baseline: input.baseline,
		audit: input.audit,
	});
	return createReviewedBoostHost({
		contract: input.contract,
		injection: {
			bridge,
			control: input.control.reference,
			shutdownChoice: input.shutdownChoice,
		},
	});
}

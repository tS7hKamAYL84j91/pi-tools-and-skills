import { describe, expect, it } from "vitest";
import {
	providerError,
	providerFailure,
	redactResearchText,
	type ProviderRequest,
	type ProviderResearchResult,
	type ResearchProviderAdapter,
} from "../../extensions/pi-research-tools/provider-contract.js";

class FakeResearchProvider implements ResearchProviderAdapter {
	readonly name = "fake";

	async execute(request: ProviderRequest): Promise<ProviderResearchResult> {
		const resultCount = request.query ? 1 : 0;
		return {
			tool: request.tool,
			provider: this.name,
			status: resultCount > 0 ? "success" : "empty",
			results: resultCount > 0 ? [{ title: "Synthetic result", sourceId: "fake:1" }] : [],
			sourceId: resultCount > 0 ? "fake:1" : undefined,
			artifactWriteStatus: request.persistToWorkspace === true ? "deferred_gate" : "not_requested",
			observability: {
				provider: this.name,
				elapsedMs: 1,
				resultCount,
				redactionCount: 0,
			},
		};
	}
}

describe("research provider contract scaffolding", () => {
	it("supports fake-provider success without network access or persistence", async () => {
		const provider = new FakeResearchProvider();
		const result = await provider.execute({ tool: "arxiv_search", query: "test", limit: 1, persistToWorkspace: true });

		expect(result).toMatchObject({
			tool: "arxiv_search",
			provider: "fake",
			status: "success",
			sourceId: "fake:1",
			artifactWriteStatus: "deferred_gate",
			observability: { resultCount: 1, redactionCount: 0 },
		});
	});

	it("redacts credential-like values from text", () => {
		const redacted = redactResearchText("Authorization: Bearer abc\nurl=https://x.test/?api_key=secret&ok=1 token=raw");

		expect(redacted.text).toContain("Authorization: [REDACTED]");
		expect(redacted.text).toContain("api_key=[REDACTED]");
		expect(redacted.text).toContain("token=[REDACTED]");
		expect(redacted.text).not.toContain("Bearer abc");
		expect(redacted.text).not.toContain("secret");
		expect(redacted.text).not.toContain("raw");
		expect(redacted.redactionCount).toBeGreaterThanOrEqual(3);
	});

	it("normalizes retryability by provider error category", () => {
		expect(providerError("rate_limited", "429 retry later")).toMatchObject({ retryable: true });
		expect(providerError("timeout", "deadline exceeded")).toMatchObject({ retryable: true });
		expect(providerError("network_error", "connection reset")).toMatchObject({ retryable: true });
		expect(providerError("credential_missing", "missing token=secret")).toMatchObject({ retryable: false, message: "missing token=[REDACTED]" });
		expect(providerError("invalid_response", "bad json")).toMatchObject({ retryable: false });
	});

	it("builds bounded failure envelopes with observability", () => {
		const failure = providerFailure("web_read", "fake", providerError("provider_error", "cookie=session"), 25);

		expect(failure).toMatchObject({
			tool: "web_read",
			provider: "fake",
			status: "failure",
			artifactWriteStatus: "deferred_gate",
			error: { category: "provider_error", retryable: false, message: "cookie=[REDACTED]" },
			observability: { provider: "fake", elapsedMs: 25, resultCount: 0 },
		});
	});
});

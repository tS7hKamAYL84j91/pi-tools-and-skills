import { describe, expect, it } from "vitest";
import { redactSecrets, redactedJsonPreview } from "../lib/secret-redaction.js";

describe("redactSecrets", () => {
	it("redacts assignment-shaped secrets without redacting ordinary prose", () => {
		const value = "example-secret-value";
		const text = [
			`api_key=${value}`,
			`apiKey=${value}`,
			`token=${value}`,
			`password: ${value}`,
			`secret='${value}'`,
			"this prose mentions secret and token without assigning values",
		].join("\n");

		const redacted = redactSecrets(text);

		expect(redacted).not.toContain(value);
		expect(redacted).toContain("api_key=[REDACTED]");
		expect(redacted).toContain("apiKey=[REDACTED]");
		expect(redacted).toContain("this prose mentions secret and token without assigning values");
	});

	it("redacts authorization headers across text and JSON-ish formats", () => {
		const bearerValue = "example-bearer-value";
		const text = [
			`Authorization: Bearer ${bearerValue}`,
			`authorization=Bearer ${bearerValue}`,
			`MiXeD-AuThOrIzAtIoN: Basic ${bearerValue}`,
			`"authorization":"Bearer ${bearerValue}"`,
		].join("\n");

		const redacted = redactSecrets(text);

		expect(redacted).not.toContain(bearerValue);
		expect(redacted).toContain("Authorization: Bearer [REDACTED]");
		expect(redacted).toContain("authorization=Bearer [REDACTED]");
		expect(redacted).toContain('"authorization":"Bearer [REDACTED]"');
	});
});

describe("redactedJsonPreview", () => {
	it("redacts nested tool args before truncating and without mutating input", () => {
		const secretValue = "example-nested-secret-value";
		const input = {
			command: "deploy",
			nested: {
				apiKey: secretValue,
				note: "ordinary secret prose",
			},
		};

		const preview = redactedJsonPreview(input, 1_000);

		expect(preview).not.toContain(secretValue);
		expect(preview).toContain("[REDACTED]");
		expect(input.nested.apiKey).toBe(secretValue);
		expect(input.nested.note).toBe("ordinary secret prose");
	});

	it("redacts before truncating", () => {
		const secretValue = "example-long-secret-value";
		const preview = redactedJsonPreview({ apiKey: secretValue }, 20);

		expect(preview).not.toContain(secretValue.slice(0, 8));
		expect(preview).toContain("[REDACT");
	});
});
